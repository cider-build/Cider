import { Config, Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { operationError } from "../../domain/errors.ts";
import { NodeId, OrganizationId, SandboxId, ServerId, VmId } from "../../domain/ids.ts";
import { SandboxState, ServerState } from "../machines/contracts.ts";
import { WorkerError } from "../gateway/errors.ts";
import { decodeNodeJson, NodeTransport } from "../gateway/node-transport.ts";
import { MetricReading } from "../metrics/contracts.ts";
import { Metrics } from "../metrics/service.ts";
import { InFlight } from "./in-flight.ts";
import { WarmPool } from "./warm-pool.ts";

const NodeRecord = Schema.Struct({ id: NodeId });
const ExpiredSandbox = Schema.Struct({
  id: SandboxId,
  vmId: VmId,
  nodeId: NodeId,
});
const NodeVm = Schema.Struct({
  id: VmId,
  status: Schema.String,
});
const NodeVmList = Schema.Array(NodeVm);

const ServerReconcileRow = Schema.Struct({
  id: ServerId,
  vmId: Schema.NullOr(VmId),
  state: ServerState,
  statusDetail: Schema.NullOr(Schema.String),
});

const SandboxReconcileRow = Schema.Struct({
  id: SandboxId,
  vmId: VmId,
  state: SandboxState,
});

const ClaimedVm = Schema.Struct({ vmId: VmId });

const ResourceKind = Schema.Literals(["sandbox", "server"]);

const StorageTarget = Schema.Struct({
  resourceKind: ResourceKind,
  resourceId: Schema.String,
  vmId: VmId,
});
type StorageTarget = typeof StorageTarget.Type;

const MetricTarget = Schema.Struct({
  organizationId: OrganizationId,
  nodeId: NodeId,
  resourceKind: ResourceKind,
  resourceId: Schema.String,
  vmId: VmId,
});

const StorageUsage = Schema.Struct({
  used_bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const NodeCutoff = Schema.Struct({ nodeId: NodeId, cutoff: Schema.DateTimeUtcFromString });
const ServerStatusWrite = Schema.Struct({
  id: ServerId,
  state: ServerState,
  statusDetail: Schema.NullOr(Schema.String),
});
const SandboxDeletion = Schema.Struct({ id: SandboxId, deletedAt: Schema.DateTimeUtcFromString });
const StorageWrite = Schema.Struct({ resourceId: Schema.String, usedBytes: Schema.Int });

const workerError = operationError(({ operation, cause }) => new WorkerError({ operation, cause }));

const logIgnored = (message: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) => Effect.logWarning(message, error)),
    Effect.ignore,
  );

export interface MaintenanceApi {
  readonly cleanupExpired: Effect.Effect<void, WorkerError>;
  readonly reconcileAll: Effect.Effect<void, WorkerError>;
  readonly collectMetrics: Effect.Effect<void, WorkerError>;
}

export class Maintenance extends Context.Service<Maintenance, MaintenanceApi>()(
  "cider/features/workers/Maintenance",
) {}

export const MaintenanceLive = Layer.effect(
  Maintenance,
  // The passes share one SQL client, one transport, and the warm pool.
  // eslint-disable-next-line max-lines-per-function
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const transport = yield* NodeTransport;
    const warmPool = yield* WarmPool;
    const inFlight = yield* InFlight;
    const metrics = yield* Metrics;
    const sandboxTtlSeconds = yield* Config.schema(
      Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
      "CIDER_SANDBOX_TTL_SECONDS",
    );

    const expiredSandboxes = SqlSchema.findAll({
      Request: Schema.DateTimeUtcFromString,
      Result: ExpiredSandbox,
      execute: (cutoff) => sql`
        SELECT id, vm_id, node_id FROM sandbox
        WHERE deleted_at IS NULL AND state = 'active' AND created_at <= ${cutoff}
      `,
    });
    const softDeleteSandbox = SqlSchema.void({
      Request: SandboxDeletion,
      execute: ({ id, deletedAt }) => sql`
        UPDATE sandbox SET deleted_at = ${deletedAt}
        WHERE id = ${id} AND deleted_at IS NULL
      `,
    });
    const settledServers = SqlSchema.findAll({
      Request: NodeCutoff,
      Result: ServerReconcileRow,
      execute: ({ nodeId, cutoff }) => sql`
        SELECT id, vm_id, state, status_detail FROM server
        WHERE node_id = ${nodeId} AND deleted_at IS NULL AND created_at <= ${cutoff}
      `,
    });
    const writeServerStatus = SqlSchema.void({
      Request: ServerStatusWrite,
      execute: ({ id, state, statusDetail }) => sql`
        UPDATE server SET state = ${state}, status_detail = ${statusDetail} WHERE id = ${id}
      `,
    });
    const settledSandboxes = SqlSchema.findAll({
      Request: NodeCutoff,
      Result: SandboxReconcileRow,
      execute: ({ nodeId, cutoff }) => sql`
        SELECT id, vm_id, state FROM sandbox
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state IN ('active', 'warm')
          AND created_at <= ${cutoff}
      `,
    });
    const claimedVms = SqlSchema.findAll({
      Request: NodeId,
      Result: ClaimedVm,
      execute: (nodeId) => sql`
        SELECT vm_id FROM sandbox WHERE node_id = ${nodeId} AND deleted_at IS NULL
        UNION
        SELECT vm_id FROM server
        WHERE node_id = ${nodeId} AND deleted_at IS NULL AND vm_id IS NOT NULL
      `,
    });
    const unmeasuredResources = SqlSchema.findAll({
      Request: NodeId,
      Result: StorageTarget,
      execute: (nodeId) => sql`
        SELECT 'server' AS resource_kind, id AS resource_id, vm_id
        FROM server
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state = 'running'
          AND storage_used_bytes IS NULL
          AND vm_id IS NOT NULL
        UNION ALL
        SELECT 'sandbox' AS resource_kind, id AS resource_id, vm_id
        FROM sandbox
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state = 'active'
          AND storage_used_bytes IS NULL
      `,
    });
    const writeSandboxStorage = SqlSchema.void({
      Request: StorageWrite,
      execute: ({ resourceId, usedBytes }) => sql`
        UPDATE sandbox SET storage_used_bytes = ${usedBytes} WHERE id = ${resourceId}
      `,
    });
    const writeServerStorage = SqlSchema.void({
      Request: StorageWrite,
      execute: ({ resourceId, usedBytes }) => sql`
        UPDATE server SET storage_used_bytes = ${usedBytes} WHERE id = ${resourceId}
      `,
    });
    const allNodes = SqlSchema.findAll({
      Request: Schema.Void,
      Result: NodeRecord,
      execute: () => sql`SELECT id FROM node`,
    });
    const metricTargets = SqlSchema.findAll({
      Request: Schema.Void,
      Result: MetricTarget,
      execute: () => sql`
        SELECT
          organization_id, node_id, 'sandbox' AS resource_kind,
          id AS resource_id, vm_id
        FROM sandbox
        WHERE deleted_at IS NULL
          AND organization_id IS NOT NULL
          AND state = 'active'
        UNION ALL
        SELECT
          organization_id, node_id, 'server' AS resource_kind,
          id AS resource_id, vm_id
        FROM server
        WHERE deleted_at IS NULL
          AND state = 'running'
          AND vm_id IS NOT NULL
      `,
    });

    const deleteExpired = Effect.fn("Maintenance.deleteExpired")(function* (
      sandbox: typeof ExpiredSandbox.Type,
    ) {
      yield* transport.request(sandbox.nodeId, "DELETE", `/sandboxes/${sandbox.vmId}`);
      const deletedAt = yield* DateTime.now;
      yield* softDeleteSandbox({ id: sandbox.id, deletedAt }).pipe(workerError("cleanup.delete"));
      return sandbox.nodeId;
    });

    const cleanupExpired = Effect.fn("Maintenance.cleanupExpired")(function* () {
      const now = yield* DateTime.now;
      const cutoff = DateTime.subtract(now, { seconds: sandboxTtlSeconds });
      const sandboxes = yield* expiredSandboxes(cutoff).pipe(workerError("cleanup.list"));
      const [failures, deletedNodeIds] = yield* Effect.partition(sandboxes, deleteExpired, {
        concurrency: 1,
      });
      yield* Effect.forEach(
        failures,
        (error) => Effect.logWarning("Maintenance.cleanup_target_failed", error),
        { discard: true },
      );
      yield* Effect.forEach(
        new Set(deletedNodeIds),
        (nodeId) => warmPool.ensureNode(nodeId).pipe(workerError("cleanup.refill")),
        { discard: true },
      );
    });

    const measureStorage = Effect.fn("Maintenance.measureStorage")(function* (
      nodeId: NodeId,
      target: StorageTarget,
    ) {
      const response = yield* transport.request(
        nodeId,
        "GET",
        `/sandboxes/${target.vmId}/storage-usage`,
      );
      const usage = yield* decodeNodeJson(response, StorageUsage, "Maintenance.measureStorage");
      const write = { resourceId: target.resourceId, usedBytes: usage.used_bytes };
      yield* (target.resourceKind === "sandbox"
        ? writeSandboxStorage(write)
        : writeServerStorage(write)
      ).pipe(workerError("reconcile.writeStorage"));
    });

    /** Aligns one server row with the VM state the node reports. */
    const reconcileServer = Effect.fn("Maintenance.reconcileServer")(function* (
      server: typeof ServerReconcileRow.Type,
      vmStatus: ReadonlyMap<VmId, string>,
    ) {
      const repairLegacyFailure = server.state === "failed" && server.statusDetail === null;
      const moving = server.state === "provisioning" || server.state === "stopping";
      const stranded = moving && !(yield* inFlight.isActive(server.id));
      if (server.state !== "running" && !repairLegacyFailure && !stranded) {
        return;
      }
      if (server.vmId === null && !stranded) {
        return;
      }
      const state = server.vmId === null ? undefined : vmStatus.get(server.vmId);
      if (state === "running") {
        if (repairLegacyFailure || stranded) {
          yield* writeServerStatus({ id: server.id, state: "running", statusDetail: null }).pipe(
            workerError("reconcile.repairRunning"),
          );
        }
        return;
      }
      const next: typeof ServerStatusWrite.Type
        = state === "stopped"
          ? {
              id: server.id,
              state: "stopped",
              statusDetail: "The node stopped this VM. Start the server to resume it.",
            }
          : stranded && state === undefined
            ? {
                id: server.id,
                state: "failed",
                statusDetail:
                  server.state === "provisioning"
                    ? "Provisioning stopped when the backend restarted, and the node has no VM for this server. Retry to build it again."
                    : "Stopping did not finish and the node has no VM for this server.",
              }
            : {
                id: server.id,
                state: "failed",
                statusDetail:
                  state === undefined
                    ? "The node no longer has this VM."
                    : `The node reports VM state: ${state}.`,
              };
      yield* writeServerStatus(next).pipe(workerError("reconcile.updateServer"));
    });

    const removeMissingSandbox = Effect.fn("Maintenance.removeMissingSandbox")(function* (
      sandbox: typeof SandboxReconcileRow.Type,
    ) {
      const deletedAt = yield* DateTime.now;
      yield* softDeleteSandbox({ id: sandbox.id, deletedAt }).pipe(
        workerError("reconcile.removeMissingSandbox"),
      );
    });

    /** Deletes a VM the node holds but no row claims. Returns whether it was removed. */
    const removeOrphanVm = Effect.fn("Maintenance.removeOrphanVm")((nodeId: NodeId, vmId: VmId) =>
      transport.request(nodeId, "DELETE", `/sandboxes/${vmId}`).pipe(
        Effect.as(true),
        Effect.tapError((error) =>
          Effect.logWarning("Maintenance.orphan_vm_delete_failed", error).pipe(
            Effect.annotateLogs({ nodeId, vmId }),
          ),
        ),
        Effect.orElseSucceed(() => false),
      ),
    );

    const reconcileNode = Effect.fn("Maintenance.reconcileNode")(function* (nodeId: NodeId) {
      const response = yield* transport.request(nodeId, "GET", "/sandboxes");
      const nodeVms = yield* decodeNodeJson(response, NodeVmList, "Maintenance.reconcileNode");
      const vmStatus = new Map(nodeVms.map((vm) => [vm.id, vm.status]));
      const now = yield* DateTime.now;
      const cutoff = DateTime.subtract(now, { seconds: 180 });

      const servers = yield* settledServers({ nodeId, cutoff }).pipe(
        workerError("reconcile.servers"),
      );
      yield* Effect.forEach(servers, (server) => reconcileServer(server, vmStatus), {
        discard: true,
      });

      const sandboxes = yield* settledSandboxes({ nodeId, cutoff }).pipe(
        workerError("reconcile.sandboxes"),
      );
      const missing = sandboxes.filter((sandbox) => !vmStatus.has(sandbox.vmId));
      yield* Effect.forEach(missing, removeMissingSandbox, { discard: true });

      const claimed = yield* claimedVms(nodeId).pipe(workerError("reconcile.claimed"));
      const claimedIds = new Set(claimed.map((row) => row.vmId));
      const orphans = nodeVms.filter((vm) => !claimedIds.has(vm.id));
      const removedOrphans = yield* Effect.forEach(orphans, (vm) => removeOrphanVm(nodeId, vm.id));
      if (missing.length > 0 || removedOrphans.some(Boolean)) {
        yield* warmPool.ensureNode(nodeId).pipe(workerError("reconcile.refill"));
      }

      const storageTargets = yield* unmeasuredResources(nodeId).pipe(
        workerError("reconcile.storageTargets"),
      );
      yield* Effect.forEach(
        storageTargets.filter((target) => vmStatus.get(target.vmId) === "running"),
        (target) => measureStorage(nodeId, target).pipe(logIgnored("Maintenance.measure_storage_failed")),
        { discard: true, concurrency: 1 },
      );
    });

    const reconcileConnectedNode = Effect.fn("Maintenance.reconcileConnectedNode")(function* (
      nodeId: NodeId,
    ) {
      if (!(yield* transport.isConnected(nodeId))) {
        return;
      }
      if ((yield* warmPool.warmingCount(nodeId)) > 0) {
        return;
      }
      yield* reconcileNode(nodeId).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Maintenance.reconcile_node_failed", error).pipe(
            Effect.annotateLogs({ nodeId }),
          ),
        ),
        Effect.ignore,
      );
    });

    const collectMetric = Effect.fn("Maintenance.collectMetric")(function* (
      target: typeof MetricTarget.Type,
    ) {
      if (!(yield* transport.isConnected(target.nodeId))) {
        return;
      }
      const response = yield* transport.request(
        target.nodeId,
        "GET",
        `/sandboxes/${target.vmId}/metrics`,
      );
      const reading = yield* decodeNodeJson(response, MetricReading, "Maintenance.collectMetrics");
      yield* metrics.record({
        organizationId: target.organizationId,
        nodeId: target.nodeId,
        resourceKind: target.resourceKind,
        resourceId: target.resourceId,
        reading,
      });
    });

    const reconcileAll = Effect.fn("Maintenance.reconcileAll")(function* () {
      const nodes = yield* allNodes(undefined).pipe(workerError("reconcile.nodes"));
      yield* Effect.forEach(nodes, (node) => reconcileConnectedNode(node.id), {
        discard: true,
        concurrency: 1,
      });
    });

    const collectMetrics = Effect.fn("Maintenance.collectMetrics")(function* () {
      const targets = yield* metricTargets(undefined).pipe(workerError("metrics.targets"));
      yield* Effect.forEach(
        targets,
        (target) =>
          collectMetric(target).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Maintenance.metric_target_failed", error).pipe(
                Effect.annotateLogs({
                  resourceKind: target.resourceKind,
                  resourceId: target.resourceId,
                }),
              ),
            ),
            Effect.ignore,
          ),
        { discard: true, concurrency: "unbounded" },
      );
      yield* metrics.prune.pipe(workerError("metrics.prune"));
    });

    return Maintenance.of({
      cleanupExpired: cleanupExpired().pipe(workerError("cleanup")),
      reconcileAll: reconcileAll().pipe(workerError("reconcile")),
      collectMetrics: collectMetrics().pipe(workerError("metrics")),
    });
  }),
);
