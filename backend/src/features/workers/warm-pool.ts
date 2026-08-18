import {
  Config,
  Context,
  DateTime,
  Effect,
  FiberMap,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { NodeId, OrganizationId, SandboxId, VmId } from "../../domain/ids.ts";
import { SandboxState } from "../machines/contracts.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { decodeNodeJson, NodeTransport } from "../gateway/node-transport.ts";
import {
  CapacityExhausted,
  InsufficientStorage,
  NoEligibleNode,
  SandboxesWarming,
  type WarmPoolError,
  warmPoolPersistenceError,
} from "./errors.ts";

const NodeRecord = Schema.Struct({
  id: NodeId,
  organizationId: OrganizationId,
  name: Schema.String,
  vmCount: Schema.Int,
  sandboxStorageBytes: Schema.NullOr(Schema.Int),
});
type NodeRecord = Schema.Schema.Type<typeof NodeRecord>;

const SandboxRecord = Schema.Struct({
  id: SandboxId,
  vmId: VmId,
  nodeId: NodeId,
  organizationId: Schema.NullOr(OrganizationId),
  state: SandboxState,
});

const CountRecord = Schema.Struct({ total: Schema.Int });
const CreatedVm = Schema.Struct({ id: VmId });

const OrganizationNodesRequest = Schema.Struct({
  organizationId: OrganizationId,
  nodeId: Schema.NullOr(NodeId),
});
const ClaimWarmRequest = Schema.Struct({
  nodeId: NodeId,
  organizationId: OrganizationId,
  state: SandboxState,
  now: Schema.DateTimeUtcFromString,
});
const SoftDeleteRequest = Schema.Struct({
  id: SandboxId,
  deletedAt: Schema.DateTimeUtcFromString,
});
const ClaimServerRequest = Schema.Struct({
  nodeId: NodeId,
  deletedAt: Schema.DateTimeUtcFromString,
});
const InsertSandboxRequest = Schema.Struct({
  id: SandboxId,
  vmId: VmId,
  nodeId: NodeId,
  organizationId: Schema.NullOr(OrganizationId),
  state: SandboxState,
  createdAt: Schema.DateTimeUtcFromString,
});

/** Internal retry signal: capacity is reserved by warmers that have not finished. */
class StillWarming extends Schema.TaggedError<StillWarming>()("StillWarming", {}) {}

export interface SandboxAllocation {
  readonly nodeId: NodeId;
  readonly sandboxId: SandboxId;
  readonly vmId: VmId;
}

export interface VmReservation {
  readonly nodeId: NodeId;
  readonly vmId: VmId | null;
}

export interface WarmPoolApi {
  readonly warmingCount: (nodeId: NodeId) => Effect.Effect<number>;
  readonly ensureNode: (nodeId: NodeId) => Effect.Effect<void, WarmPoolError>;
  readonly reconcileNodeWarmPool: (nodeId: NodeId) => Effect.Effect<void, WarmPoolError>;
  readonly createSandbox: (
    organizationId: OrganizationId,
    state: SandboxState,
    nodeId?: NodeId,
    minStorageBytes?: number,
  ) => Effect.Effect<SandboxAllocation, WarmPoolError>;
  readonly reserveArchiveSandbox: (
    organizationId: OrganizationId,
    nodeId?: NodeId,
    minStorageBytes?: number,
  ) => Effect.Effect<VmReservation, WarmPoolError>;
  readonly claimServerVm: (
    organizationId: OrganizationId,
    nodeId?: NodeId,
  ) => Effect.Effect<VmReservation, WarmPoolError>;
  readonly releaseReservation: (nodeId: NodeId) => Effect.Effect<void>;
  readonly findCapacityNode: (
    organizationId: OrganizationId,
    nodeId?: NodeId,
  ) => Effect.Effect<NodeId, WarmPoolError>;
}

export class WarmPool extends Context.Service<WarmPool, WarmPoolApi>()(
  "cider/features/workers/WarmPool",
) {}

export const WarmPoolLive = Layer.effect(
  WarmPool,
  // The service methods share one SQL client, one transport, and one warming ledger.
  // eslint-disable-next-line max-lines-per-function
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const transport = yield* NodeTransport;
    const ids = yield* IdGenerator;
    const targetWarmCount = yield* Config.schema(
      Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      "CIDER_WARM_SANDBOXES_PER_NODE",
    );
    const createWaitSeconds = yield* Config.schema(
      Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
      "CIDER_SANDBOX_CREATE_WAIT_SECONDS",
    );
    const warming = yield* Ref.make<ReadonlyMap<NodeId, number>>(new Map());
    const fibers = yield* FiberMap.make<string, void, never>();

    const nodeById = SqlSchema.findOneOption({
      Request: NodeId,
      Result: NodeRecord,
      execute: (nodeId) => sql`
        SELECT id, organization_id, name, vm_count, sandbox_storage_bytes
        FROM node WHERE id = ${nodeId}
      `,
    });
    const organizationNodes = SqlSchema.findAll({
      Request: OrganizationNodesRequest,
      Result: NodeRecord,
      execute: ({ organizationId, nodeId }) => sql`
        SELECT id, organization_id, name, vm_count, sandbox_storage_bytes
        FROM node
        WHERE organization_id = ${organizationId}
          AND (${nodeId} IS NULL OR id = ${nodeId})
        ORDER BY name
      `,
    });
    const liveSandboxesQuery = SqlSchema.findAll({
      Request: NodeId,
      Result: SandboxRecord,
      execute: (nodeId) => sql`
        SELECT id, vm_id, node_id, organization_id, state
        FROM sandbox WHERE node_id = ${nodeId} AND deleted_at IS NULL
        ORDER BY created_at
      `,
    });
    const runningServerCountQuery = SqlSchema.findOne({
      Request: NodeId,
      Result: CountRecord,
      execute: (nodeId) => sql`
        SELECT COUNT(*) AS total FROM server
        WHERE node_id = ${nodeId} AND deleted_at IS NULL AND state != 'stopped'
      `,
    });
    const firstWarmQuery = SqlSchema.findOneOption({
      Request: NodeId,
      Result: SandboxRecord,
      execute: (nodeId) => sql`
        SELECT id, vm_id, node_id, organization_id, state
        FROM sandbox
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state = 'warm'
          AND organization_id IS NULL
        ORDER BY created_at
        LIMIT 1
      `,
    });
    const claimWarmQuery = SqlSchema.findOneOption({
      Request: ClaimWarmRequest,
      Result: SandboxRecord,
      execute: ({ nodeId, organizationId, state, now }) => sql`
        UPDATE sandbox SET
          organization_id = ${organizationId},
          state = ${state},
          created_at = ${now},
          deleted_at = NULL
        WHERE id = (
          SELECT id FROM sandbox
          WHERE node_id = ${nodeId}
            AND deleted_at IS NULL
            AND state = 'warm'
            AND organization_id IS NULL
          ORDER BY created_at
          LIMIT 1
        )
        RETURNING id, vm_id, node_id, organization_id, state
      `,
    });
    const claimWarmForServerQuery = SqlSchema.findOneOption({
      Request: ClaimServerRequest,
      Result: SandboxRecord,
      execute: ({ nodeId, deletedAt }) => sql`
        UPDATE sandbox SET deleted_at = ${deletedAt}
        WHERE id = (
          SELECT id FROM sandbox
          WHERE node_id = ${nodeId}
            AND deleted_at IS NULL
            AND state = 'warm'
            AND organization_id IS NULL
          ORDER BY created_at
          LIMIT 1
        )
        RETURNING id, vm_id, node_id, organization_id, state
      `,
    });
    const softDeleteSandbox = SqlSchema.void({
      Request: SoftDeleteRequest,
      execute: ({ id, deletedAt }) => sql`
        UPDATE sandbox SET deleted_at = ${deletedAt}
        WHERE id = ${id} AND deleted_at IS NULL
      `,
    });
    const insertSandboxQuery = SqlSchema.void({
      Request: InsertSandboxRequest,
      execute: ({ id, vmId, nodeId, organizationId, state, createdAt }) => sql`
        INSERT INTO sandbox (
          id, vm_id, node_id, organization_id, launch_configuration,
          storage_used_bytes, state, expires_at, created_at, deleted_at
        ) VALUES (
          ${id}, ${vmId}, ${nodeId}, ${organizationId}, NULL,
          NULL, ${state}, NULL, ${createdAt}, NULL
        )
      `,
    });

    const warmingCount = Effect.fn("WarmPool.warmingCount")((nodeId: NodeId) =>
      Ref.get(warming).pipe(Effect.map((counts) => counts.get(nodeId) ?? 0)),
    );

    const addWarming = Effect.fn("WarmPool.addWarming")((nodeId: NodeId, amount: number) =>
      Ref.update(warming, (counts) => {
        const next = new Map(counts);
        const count = Math.max(0, (next.get(nodeId) ?? 0) + amount);
        if (count === 0) {
          next.delete(nodeId);
        } else {
          next.set(nodeId, count);
        }
        return next;
      }),
    );

    const releaseReservation = Effect.fn("WarmPool.releaseReservation")((nodeId: NodeId) =>
      addWarming(nodeId, -1),
    );

    const requireNode = Effect.fn("WarmPool.requireNode")(function* (nodeId: NodeId) {
      const node = yield* nodeById(nodeId).pipe(warmPoolPersistenceError("nodeById"));
      if (Option.isNone(node)) {
        return yield* new NoEligibleNode({ detail: `node not found: ${nodeId}` });
      }
      return node.value;
    });

    const availableNodes = Effect.fn("WarmPool.availableNodes")(function* (
      organizationId: OrganizationId,
      nodeId?: NodeId,
    ) {
      const nodes = yield* organizationNodes({ organizationId, nodeId: nodeId ?? null }).pipe(
        warmPoolPersistenceError("organizationNodes"),
      );
      return yield* Effect.filter(nodes, (node) => transport.isConnected(node.id), {
        concurrency: "unbounded",
      });
    });

    const requireNodes = Effect.fn("WarmPool.requireNodes")(function* (
      organizationId: OrganizationId,
      nodeId?: NodeId,
      minStorageBytes?: number,
    ) {
      const nodes = yield* availableNodes(organizationId, nodeId);
      if (nodes.length === 0) {
        return yield* new NoEligibleNode({
          detail: nodeId === undefined ? "no nodes registered" : "node not found or not connected",
        });
      }
      if (minStorageBytes === undefined) {
        return nodes;
      }
      const withStorage = nodes.filter(
        (node) => node.sandboxStorageBytes !== null && node.sandboxStorageBytes >= minStorageBytes,
      );
      if (withStorage.length === 0) {
        const gigabytes = minStorageBytes / 1024 ** 3;
        return yield* new InsufficientStorage({
          minStorageBytes,
          detail: `no connected node offers ${gigabytes.toFixed(0)} GB of storage per sandbox`,
        });
      }
      return withStorage;
    });

    const liveSandboxes = Effect.fn("WarmPool.liveSandboxes")((nodeId: NodeId) =>
      liveSandboxesQuery(nodeId).pipe(warmPoolPersistenceError("liveSandboxes")),
    );

    const runningServerCount = Effect.fn("WarmPool.runningServerCount")((nodeId: NodeId) =>
      runningServerCountQuery(nodeId).pipe(
        Effect.map((row) => row.total),
        warmPoolPersistenceError("runningServerCount"),
      ),
    );

    const nodeHasCapacity = Effect.fn("WarmPool.nodeHasCapacity")(function* (node: NodeRecord) {
      const sandboxes = yield* liveSandboxes(node.id);
      const local = sandboxes.filter((sandbox) => sandbox.state !== "stopped").length;
      const servers = yield* runningServerCount(node.id);
      const reserved = yield* warmingCount(node.id);
      return local + servers + reserved < node.vmCount;
    });

    const claimWarm = Effect.fn("WarmPool.claimWarm")(function* (
      nodeId: NodeId,
      organizationId: OrganizationId,
      state: SandboxState,
    ) {
      const now = yield* DateTime.now;
      return yield* claimWarmQuery({ nodeId, organizationId, state, now }).pipe(
        warmPoolPersistenceError("claimWarm"),
      );
    });

    const claimWarmForServer = Effect.fn("WarmPool.claimWarmForServer")(function* (
      nodeId: NodeId,
    ) {
      const deletedAt = yield* DateTime.now;
      return yield* claimWarmForServerQuery({ nodeId, deletedAt }).pipe(
        warmPoolPersistenceError("claimWarmForServer"),
      );
    });

    const evictWarm = Effect.fn("WarmPool.evictWarm")(function* (
      nodeId: NodeId,
      sandbox: { readonly id: SandboxId; readonly vmId: VmId },
    ) {
      yield* transport.request(nodeId, "DELETE", `/sandboxes/${sandbox.vmId}`);
      const deletedAt = yield* DateTime.now;
      yield* softDeleteSandbox({ id: sandbox.id, deletedAt }).pipe(
        warmPoolPersistenceError("evictWarm"),
      );
    });

    const insertSandbox = Effect.fn("WarmPool.insertSandbox")(function* (
      nodeId: NodeId,
      vmId: VmId,
      state: SandboxState,
      organizationId: OrganizationId | null,
    ) {
      // A sandbox id is its VM id; both share one format.
      const sandboxId = SandboxId.make(vmId);
      const createdAt = yield* DateTime.now;
      yield* insertSandboxQuery({ id: sandboxId, vmId, nodeId, organizationId, state, createdAt })
        .pipe(warmPoolPersistenceError("insertSandbox"));
      return { nodeId, sandboxId, vmId } satisfies SandboxAllocation;
    });

    const createVm = Effect.fn("WarmPool.createVm")(function* (nodeId: NodeId) {
      const response = yield* transport.request(nodeId, "POST", "/sandboxes");
      const created = yield* decodeNodeJson(response, CreatedVm, "WarmPool.createVm");
      return created.id;
    });

    const warmOne = Effect.fn("WarmPool.warmOne")(function* (nodeId: NodeId) {
      const node = yield* requireNode(nodeId);
      const vmId = yield* createVm(node.id);
      yield* insertSandbox(node.id, vmId, "warm", null);
    });

    const startWarmOne = Effect.fn("WarmPool.startWarmOne")(function* (nodeId: NodeId) {
      yield* addWarming(nodeId, 1);
      const key = `${nodeId}:${yield* ids.uuid}`;
      const task = warmOne(nodeId).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("WarmPool.warm_failed", error).pipe(Effect.annotateLogs({ nodeId })),
        ),
        Effect.ignore,
        Effect.ensuring(releaseReservation(nodeId)),
      );
      yield* FiberMap.run(fibers, key)(task);
    });

    const ensureNode = Effect.fn("WarmPool.ensureNode")(function* (nodeId: NodeId) {
      const node = yield* nodeById(nodeId).pipe(warmPoolPersistenceError("nodeById"));
      if (Option.isNone(node)) {
        return;
      }
      const sandboxes = yield* liveSandboxes(nodeId);
      const allocated
        = sandboxes.filter((sandbox) => sandbox.state !== "warm" && sandbox.state !== "stopped")
          .length + (yield* runningServerCount(nodeId));
      const warm = sandboxes.filter((sandbox) => sandbox.state === "warm").length;
      const target = Math.min(targetWarmCount, node.value.vmCount - allocated);
      const activeWarmers = yield* warmingCount(nodeId);
      const needed = Math.max(0, target - warm - activeWarmers);
      yield* Effect.forEach(Array.from({ length: needed }), () => startWarmOne(nodeId), {
        discard: true,
      });
    });

    const reconcileNodeWarmPool = Effect.fn("WarmPool.reconcileNodeWarmPool")(function* (
      nodeId: NodeId,
    ) {
      const node = yield* requireNode(nodeId);
      const sandboxes = yield* liveSandboxes(nodeId);
      const allocated
        = sandboxes.filter((sandbox) => sandbox.state !== "warm" && sandbox.state !== "stopped")
          .length + (yield* runningServerCount(nodeId));
      const warm = sandboxes.filter((sandbox) => sandbox.state === "warm");
      const target = Math.min(targetWarmCount, Math.max(0, node.vmCount - allocated));
      const extra = warm.slice(target);
      yield* Effect.forEach(extra, (sandbox) => evictWarm(node.id, sandbox), { discard: true });
      yield* ensureNode(nodeId);
    });

    const createAttempt = Effect.fn("WarmPool.createAttempt")(function* (
      organizationId: OrganizationId,
      state: SandboxState,
      nodeId?: NodeId,
      minStorageBytes?: number,
    ) {
      const nodes = yield* requireNodes(organizationId, nodeId, minStorageBytes);
      for (const node of nodes) {
        const claimed = yield* claimWarm(node.id, organizationId, state);
        if (Option.isSome(claimed)) {
          yield* ensureNode(node.id);
          return {
            nodeId: node.id,
            sandboxId: claimed.value.id,
            vmId: claimed.value.vmId,
          } satisfies SandboxAllocation;
        }
      }
      for (const node of nodes) {
        if (yield* nodeHasCapacity(node)) {
          const vmId = yield* createVm(node.id);
          const allocation = yield* insertSandbox(node.id, vmId, state, organizationId);
          yield* ensureNode(node.id);
          return allocation;
        }
      }
      const counts = yield* Effect.forEach(nodes, (node) => warmingCount(node.id));
      if (counts.some((count) => count > 0)) {
        return yield* new StillWarming();
      }
      return yield* new CapacityExhausted({ detail: "all nodes are at capacity." });
    });

    const createSandbox = Effect.fn("WarmPool.createSandbox")((
      organizationId: OrganizationId,
      state: SandboxState,
      nodeId?: NodeId,
      minStorageBytes?: number,
    ) =>
      createAttempt(organizationId, state, nodeId, minStorageBytes).pipe(
        Effect.retry({
          while: (error) => error._tag === "StillWarming",
          times: createWaitSeconds - 1,
          schedule: Schedule.spaced("1 second"),
        }),
        Effect.catchTag(
          "StillWarming",
          () => new SandboxesWarming({ detail: "sandboxes are still warming; try again shortly" }),
        ),
      ),
    );

    const reserveArchiveSandbox = Effect.fn("WarmPool.reserveArchiveSandbox")(function* (
      organizationId: OrganizationId,
      nodeId?: NodeId,
      minStorageBytes?: number,
    ) {
      const nodes = yield* requireNodes(organizationId, nodeId, minStorageBytes);
      for (const node of nodes) {
        const claimed = yield* claimWarm(node.id, organizationId, "provisioning");
        if (Option.isSome(claimed)) {
          return { nodeId: node.id, vmId: claimed.value.vmId } satisfies VmReservation;
        }
      }
      for (const node of nodes) {
        if (yield* nodeHasCapacity(node)) {
          return { nodeId: node.id, vmId: null } satisfies VmReservation;
        }
      }
      return yield* new CapacityExhausted({
        detail: "all nodes are at their configured VM capacity",
      });
    });

    const claimServerVm = Effect.fn("WarmPool.claimServerVm")(function* (
      organizationId: OrganizationId,
      nodeId?: NodeId,
    ) {
      const nodes = yield* requireNodes(organizationId, nodeId);
      for (const node of nodes) {
        const claimed = yield* claimWarmForServer(node.id);
        if (Option.isSome(claimed)) {
          return { nodeId: node.id, vmId: claimed.value.vmId } satisfies VmReservation;
        }
      }
      for (const node of nodes) {
        if (yield* nodeHasCapacity(node)) {
          yield* addWarming(node.id, 1);
          return { nodeId: node.id, vmId: null } satisfies VmReservation;
        }
      }
      return yield* new CapacityExhausted({
        detail: "all nodes are at their configured VM capacity",
      });
    });

    const findCapacityNode = Effect.fn("WarmPool.findCapacityNode")(function* (
      organizationId: OrganizationId,
      nodeId?: NodeId,
    ) {
      const nodes = yield* availableNodes(organizationId, nodeId);
      if (nodes.length === 0) {
        return yield* new NoEligibleNode({
          detail: nodeId === undefined ? "no connected nodes" : "connected destination node not found",
        });
      }
      for (const node of nodes) {
        if (yield* nodeHasCapacity(node)) {
          return node.id;
        }
        const warm = yield* firstWarmQuery(node.id).pipe(warmPoolPersistenceError("firstWarm"));
        if (Option.isSome(warm)) {
          yield* evictWarm(node.id, warm.value);
          return node.id;
        }
      }
      return yield* new CapacityExhausted({
        detail: "every connected node is at its VM capacity; stop something first",
      });
    });

    return WarmPool.of({
      warmingCount,
      ensureNode,
      reconcileNodeWarmPool,
      createSandbox,
      reserveArchiveSandbox,
      claimServerVm,
      releaseReservation,
      findCapacityNode,
    });
  }),
);
