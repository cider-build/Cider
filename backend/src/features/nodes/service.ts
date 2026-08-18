import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { hashToken, parseBearerToken } from "../../auth/tokens.ts";
import { operationError } from "../../domain/errors.ts";
import { NodeId, OrganizationId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import {
  NodeConfigurationRejected,
  NodeConflict,
  NodeConnectionRejected,
  NodeNotFound,
  NodePersistenceError,
  type NodeRuntimeError,
} from "./errors.ts";
import { NodeRuntime } from "./runtime.ts";
import type {
  NodeConfigurationInput,
  NodeEnrollmentInput,
  NodeEnrollmentOutput,
  NodeMetadataInput,
  NodeOutput,
  NodePage,
} from "./schemas.ts";

const PAGE_SIZE = 10;

const VmCount = Schema.Union([Schema.Literal(1), Schema.Literal(2)]);

const NodeRecord = Schema.Struct({
  id: NodeId,
  organizationId: OrganizationId,
  name: Schema.String,
  hardwareModel: Schema.NullOr(Schema.String),
  chip: Schema.NullOr(Schema.String),
  macosVersion: Schema.NullOr(Schema.String),
  cpuCount: Schema.NullOr(Schema.Int),
  memoryBytes: Schema.NullOr(Schema.Int),
  storageTotalBytes: Schema.NullOr(Schema.Int),
  storageAvailableBytes: Schema.NullOr(Schema.Int),
  vmCount: VmCount,
  sandboxCpuCount: Schema.NullOr(Schema.Int),
  sandboxMemoryBytes: Schema.NullOr(Schema.Int),
  sandboxStorageBytes: Schema.NullOr(Schema.Int),
});
type NodeRecord = Schema.Schema.Type<typeof NodeRecord>;

const CountRecord = Schema.Struct({ total: Schema.Int });
const IdRecord = Schema.Struct({ id: NodeId });

const NodeLookup = Schema.Struct({ organizationId: OrganizationId, nodeId: NodeId });
const NodeNameLookup = Schema.Struct({ organizationId: OrganizationId, name: Schema.String });
const NodeSearch = Schema.Struct({
  organizationId: OrganizationId,
  pattern: Schema.NullOr(Schema.String),
});
const NodePageRequest = Schema.Struct({
  ...NodeSearch.fields,
  limit: Schema.Int,
  offset: Schema.Int,
});
const CredentialWrite = Schema.Struct({
  nodeId: NodeId,
  tokenHash: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
const CredentialCheck = Schema.Struct({ nodeId: NodeId, tokenHash: Schema.String });
const NodeInsert = Schema.Struct({
  id: NodeId,
  organizationId: OrganizationId,
  name: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
const ConfigurationWrite = Schema.Struct({
  organizationId: OrganizationId,
  nodeId: NodeId,
  vmCount: VmCount,
  sandboxCpuCount: Schema.Int,
  sandboxMemoryBytes: Schema.Int,
  sandboxStorageBytes: Schema.Int,
});
const MetadataWrite = Schema.Struct({
  nodeId: NodeId,
  hardwareModel: Schema.String,
  chip: Schema.String,
  macosVersion: Schema.String,
  cpuCount: Schema.Int,
  memoryBytes: Schema.Int,
  storageTotalBytes: Schema.Int,
  storageAvailableBytes: Schema.Int,
  defaultVmCount: VmCount,
  defaultSandboxCpuCount: Schema.Int,
  defaultSandboxMemoryBytes: Schema.Int,
  defaultSandboxStorageBytes: Schema.Int,
});
type MetadataWrite = Schema.Schema.Type<typeof MetadataWrite>;
const NodeDeletion = Schema.Struct({ nodeId: NodeId, deletedAt: Schema.DateTimeUtcFromString });

const persistenceError = operationError(
  ({ operation, cause }) => new NodePersistenceError({ operation, cause }),
);

const metadataWrite = (nodeId: NodeId, metadata: NodeMetadataInput): MetadataWrite => {
  const supportsTwo
    = metadata.default_sandbox_cpu_count * 2 <= metadata.cpu_count
      && metadata.default_sandbox_memory_bytes * 2 <= metadata.memory_bytes
      && metadata.default_sandbox_storage_bytes * 2 <= metadata.storage_total_bytes;
  return {
    nodeId,
    hardwareModel: metadata.hardware_model,
    chip: metadata.chip,
    macosVersion: metadata.macos_version,
    cpuCount: metadata.cpu_count,
    memoryBytes: metadata.memory_bytes,
    storageTotalBytes: metadata.storage_total_bytes,
    storageAvailableBytes: metadata.storage_available_bytes,
    defaultVmCount: supportsTwo ? 2 : 1,
    defaultSandboxCpuCount: metadata.default_sandbox_cpu_count,
    defaultSandboxMemoryBytes: metadata.default_sandbox_memory_bytes,
    defaultSandboxStorageBytes: metadata.default_sandbox_storage_bytes,
  };
};

const toOutput = (node: NodeRecord, connected: boolean): NodeOutput => {
  const metadata
    = node.hardwareModel !== null
      && node.chip !== null
      && node.macosVersion !== null
      && node.cpuCount !== null
      && node.memoryBytes !== null
      && node.storageTotalBytes !== null
      && node.storageAvailableBytes !== null
      ? {
          hardware_model: node.hardwareModel,
          chip: node.chip,
          macos_version: node.macosVersion,
          cpu_count: node.cpuCount,
          memory_bytes: node.memoryBytes,
          storage_total_bytes: node.storageTotalBytes,
          storage_available_bytes: node.storageAvailableBytes,
        }
      : null;
  const configuration: NodeOutput["configuration"]
    = node.sandboxCpuCount !== null
      && node.sandboxMemoryBytes !== null
      && node.sandboxStorageBytes !== null
      ? {
          vm_count: node.vmCount,
          sandbox_cpu_count: node.sandboxCpuCount,
          sandbox_memory_bytes: node.sandboxMemoryBytes,
          sandbox_storage_bytes: node.sandboxStorageBytes,
        }
      : null;
  return { id: node.id, name: node.name, connected, metadata, configuration };
};

export interface NodeServiceApi {
  readonly list: (
    organizationId: OrganizationId,
    page: number,
    search: string,
  ) => Effect.Effect<NodePage, NodePersistenceError>;
  readonly get: (
    organizationId: OrganizationId,
    nodeId: NodeId,
  ) => Effect.Effect<NodeOutput, NodeNotFound | NodePersistenceError>;
  readonly enroll: (
    organizationId: OrganizationId,
    input: NodeEnrollmentInput,
  ) => Effect.Effect<NodeEnrollmentOutput, NodeConflict | NodePersistenceError>;
  readonly updateConfiguration: (
    organizationId: OrganizationId,
    nodeId: NodeId,
    input: NodeConfigurationInput,
  ) => Effect.Effect<
    NodeOutput,
    | NodeNotFound
    | NodeConflict
    | NodeConfigurationRejected
    | NodePersistenceError
    | NodeRuntimeError
  >;
  readonly delete: (
    organizationId: OrganizationId,
    nodeId: NodeId,
  ) => Effect.Effect<void, NodeNotFound | NodeConflict | NodePersistenceError | NodeRuntimeError>;
  readonly applyMetadata: (
    nodeId: NodeId,
    metadata: NodeMetadataInput,
  ) => Effect.Effect<void, NodeNotFound | NodePersistenceError>;
  readonly connect: (
    nodeId: NodeId,
    authorization: string | undefined,
    metadata: NodeMetadataInput,
  ) => Effect.Effect<void, NodeConnectionRejected | NodePersistenceError>;
}

export class NodeService extends Context.Service<NodeService, NodeServiceApi>()(
  "cider/features/nodes/NodeService",
) {}

export const NodeServiceLive = Layer.effect(
  NodeService,
  // The service methods share one SQL client and one runtime adapter.
  // eslint-disable-next-line max-lines-per-function
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ids = yield* IdGenerator;
    const runtime = yield* NodeRuntime;

    const enrolledNodeById = SqlSchema.findOneOption({
      Request: NodeLookup,
      Result: NodeRecord,
      execute: ({ organizationId, nodeId }) => sql`
        SELECT n.* FROM node n
        INNER JOIN node_credential nc ON nc.node_id = n.id
        WHERE n.id = ${nodeId} AND n.organization_id = ${organizationId}
      `,
    });
    const nodeById = SqlSchema.findOneOption({
      Request: NodeLookup,
      Result: NodeRecord,
      execute: ({ organizationId, nodeId }) => sql`
        SELECT * FROM node
        WHERE id = ${nodeId} AND organization_id = ${organizationId}
      `,
    });
    const nodeByName = SqlSchema.findOneOption({
      Request: NodeNameLookup,
      Result: NodeRecord,
      execute: ({ organizationId, name }) => sql`
        SELECT * FROM node
        WHERE organization_id = ${organizationId} AND name = ${name}
      `,
    });
    const countEnrolled = SqlSchema.findOne({
      Request: NodeSearch,
      Result: CountRecord,
      execute: ({ organizationId, pattern }) => sql`
        SELECT COUNT(*) AS total FROM node n
        INNER JOIN node_credential nc ON nc.node_id = n.id
        WHERE n.organization_id = ${organizationId}
          AND (${pattern} IS NULL OR n.name LIKE ${pattern})
      `,
    });
    const listEnrolled = SqlSchema.findAll({
      Request: NodePageRequest,
      Result: NodeRecord,
      execute: ({ organizationId, pattern, limit, offset }) => sql`
        SELECT n.* FROM node n
        INNER JOIN node_credential nc ON nc.node_id = n.id
        WHERE n.organization_id = ${organizationId}
          AND (${pattern} IS NULL OR n.name LIKE ${pattern})
        ORDER BY n.name LIMIT ${limit} OFFSET ${offset}
      `,
    });
    const upsertCredential = SqlSchema.void({
      Request: CredentialWrite,
      execute: ({ nodeId, tokenHash, createdAt }) => sql`
        INSERT INTO node_credential (node_id, token_hash, created_at)
        VALUES (${nodeId}, ${tokenHash}, ${createdAt})
        ON CONFLICT(node_id) DO UPDATE SET
          token_hash = excluded.token_hash,
          created_at = excluded.created_at
      `,
    });
    const insertCredential = SqlSchema.void({
      Request: CredentialWrite,
      execute: ({ nodeId, tokenHash, createdAt }) => sql`
        INSERT INTO node_credential (node_id, token_hash, created_at)
        VALUES (${nodeId}, ${tokenHash}, ${createdAt})
      `,
    });
    const credentialMatches = SqlSchema.findOneOption({
      Request: CredentialCheck,
      Result: Schema.Struct({ nodeId: NodeId }),
      execute: ({ nodeId, tokenHash }) => sql`
        SELECT node_id FROM node_credential
        WHERE node_id = ${nodeId} AND token_hash = ${tokenHash}
      `,
    });
    /** Returns `None` when another node in the organization already has the name. */
    const insertNode = SqlSchema.findOneOption({
      Request: NodeInsert,
      Result: NodeRecord,
      execute: ({ id, organizationId, name, createdAt }) => sql`
        INSERT INTO node (id, organization_id, name, vm_count, created_at)
        VALUES (${id}, ${organizationId}, ${name}, 2, ${createdAt})
        ON CONFLICT(organization_id, name) DO NOTHING
        RETURNING *
      `,
    });
    const writeConfiguration = SqlSchema.findOneOption({
      Request: ConfigurationWrite,
      Result: NodeRecord,
      execute: (input) => sql`
        UPDATE node SET
          vm_count = ${input.vmCount},
          sandbox_cpu_count = ${input.sandboxCpuCount},
          sandbox_memory_bytes = ${input.sandboxMemoryBytes},
          sandbox_storage_bytes = ${input.sandboxStorageBytes}
        WHERE id = ${input.nodeId} AND organization_id = ${input.organizationId}
        RETURNING *
      `,
    });
    /** Writes hardware metadata. Sandbox defaults only fill columns that are still NULL. */
    const writeMetadata = SqlSchema.findOneOption({
      Request: MetadataWrite,
      Result: IdRecord,
      execute: (input) => sql`
        UPDATE node SET
          hardware_model = ${input.hardwareModel},
          chip = ${input.chip},
          macos_version = ${input.macosVersion},
          cpu_count = ${input.cpuCount},
          memory_bytes = ${input.memoryBytes},
          storage_total_bytes = ${input.storageTotalBytes},
          storage_available_bytes = ${input.storageAvailableBytes},
          vm_count = CASE
            WHEN sandbox_cpu_count IS NULL
              AND sandbox_memory_bytes IS NULL
              AND sandbox_storage_bytes IS NULL
            THEN ${input.defaultVmCount}
            ELSE vm_count
          END,
          sandbox_cpu_count = COALESCE(sandbox_cpu_count, ${input.defaultSandboxCpuCount}),
          sandbox_memory_bytes = COALESCE(sandbox_memory_bytes, ${input.defaultSandboxMemoryBytes}),
          sandbox_storage_bytes = COALESCE(sandbox_storage_bytes, ${input.defaultSandboxStorageBytes})
        WHERE id = ${input.nodeId}
        RETURNING id
      `,
    });
    const runningServerCount = SqlSchema.findOne({
      Request: NodeId,
      Result: CountRecord,
      execute: (nodeId) => sql`
        SELECT COUNT(*) AS total FROM server
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state IN ('running', 'provisioning')
      `,
    });
    const activeSandboxCount = SqlSchema.findOne({
      Request: NodeId,
      Result: CountRecord,
      execute: (nodeId) => sql`
        SELECT COUNT(*) AS total FROM sandbox
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND organization_id IS NOT NULL
          AND state NOT IN ('stopped', 'paused')
      `,
    });
    const softDeleteNodeSandboxes = SqlSchema.void({
      Request: NodeDeletion,
      execute: ({ nodeId, deletedAt }) => sql`
        UPDATE sandbox SET deleted_at = ${deletedAt}
        WHERE node_id = ${nodeId}
          AND deleted_at IS NULL
          AND state NOT IN ('stopped', 'paused')
      `,
    });
    const deleteCredential = SqlSchema.void({
      Request: NodeId,
      execute: (nodeId) => sql`DELETE FROM node_credential WHERE node_id = ${nodeId}`,
    });

    const requireNode = <E>(
      lookup: Effect.Effect<Option.Option<NodeRecord>, E>,
      nodeId: NodeId,
    ) =>
      lookup.pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => new NodeNotFound({ nodeId }),
            onSome: Effect.succeed,
          }),
        ),
      );

    const getEnrolledRecord = Effect.fn("Nodes.getEnrolledRecord")((
      organizationId: OrganizationId,
      nodeId: NodeId,
    ) =>
      requireNode(
        enrolledNodeById({ organizationId, nodeId }).pipe(persistenceError("getEnrolledRecord")),
        nodeId,
      ),
    );

    const getRecord = Effect.fn("Nodes.getRecord")((organizationId: OrganizationId, nodeId: NodeId) =>
      requireNode(nodeById({ organizationId, nodeId }).pipe(persistenceError("getRecord")), nodeId),
    );

    const output = Effect.fn("Nodes.output")(function* (node: NodeRecord) {
      const connected = yield* runtime.isConnected(node.id);
      return toOutput(node, connected);
    });

    const list = Effect.fn("Nodes.list")(function* (
      organizationId: OrganizationId,
      requestedPage: number,
      search: string,
    ) {
      const pattern = search.length === 0 ? null : `%${search}%`;
      const { total } = yield* countEnrolled({ organizationId, pattern }).pipe(
        persistenceError("list.count"),
      );
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(requestedPage, pages);
      const offset = (page - 1) * PAGE_SIZE;
      const nodes = yield* listEnrolled({ organizationId, pattern, limit: PAGE_SIZE, offset }).pipe(
        persistenceError("list.rows"),
      );
      const items = yield* Effect.forEach(nodes, output, { concurrency: "unbounded" });
      return { items, page, pages, total };
    });

    const get = Effect.fn("Nodes.get")((organizationId: OrganizationId, nodeId: NodeId) =>
      getEnrolledRecord(organizationId, nodeId).pipe(Effect.flatMap(output)),
    );

    const enroll = Effect.fn("Nodes.enroll")(function* (
      organizationId: OrganizationId,
      input: NodeEnrollmentInput,
    ) {
      const existing = yield* nodeByName({ organizationId, name: input.name }).pipe(
        persistenceError("enroll.findExisting"),
      );
      const token = yield* ids.token;
      const tokenHash = hashToken(token);
      const createdAt = yield* DateTime.now;

      if (Option.isSome(existing)) {
        const node = existing.value;
        if (yield* runtime.isConnected(node.id)) {
          return yield* new NodeConflict({ detail: "node name already exists and is connected" });
        }
        yield* upsertCredential({ nodeId: node.id, tokenHash, createdAt }).pipe(
          persistenceError("enroll.rotateCredential"),
        );
        return { id: node.id, name: node.name, token };
      }

      const id = NodeId.make(yield* ids.uuid);
      const inserted = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const row = yield* insertNode({ id, organizationId, name: input.name, createdAt }).pipe(
              persistenceError("enroll.insertNode"),
            );
            if (Option.isNone(row)) {
              return yield* new NodeConflict({ detail: "node name already exists" });
            }
            yield* insertCredential({ nodeId: id, tokenHash, createdAt }).pipe(
              persistenceError("enroll.insertCredential"),
            );
            return row.value;
          }),
        )
        .pipe(Effect.catchTag("SqlError", (cause) =>
          new NodePersistenceError({ operation: "enroll.transaction", cause }),
        ));
      return { id: inserted.id, name: inserted.name, token };
    });

    const updateConfiguration = Effect.fn("Nodes.updateConfiguration")(function* (
      organizationId: OrganizationId,
      nodeId: NodeId,
      input: NodeConfigurationInput,
    ) {
      const node = yield* getRecord(organizationId, nodeId);
      if (!(yield* runtime.isConnected(node.id))) {
        return yield* new NodeConflict({
          detail: "node must be connected to change its configuration",
        });
      }
      if ((yield* runtime.warmingCount(node.id)) > 0) {
        return yield* new NodeConflict({
          detail: "wait for node provisioning to finish before changing its configuration",
        });
      }
      if (
        node.cpuCount === null
        || node.memoryBytes === null
        || node.storageAvailableBytes === null
      ) {
        return yield* new NodeConflict({ detail: "node hardware metadata is unavailable" });
      }
      if (input.sandbox_cpu_count * input.vm_count > node.cpuCount) {
        return yield* new NodeConfigurationRejected({
          detail: "configured sandboxes exceed the node's CPU capacity",
        });
      }
      if (input.sandbox_memory_bytes * input.vm_count > node.memoryBytes) {
        return yield* new NodeConfigurationRejected({
          detail: "configured sandboxes exceed the node's memory capacity",
        });
      }
      if (input.sandbox_storage_bytes * input.vm_count > node.storageAvailableBytes) {
        return yield* new NodeConfigurationRejected({
          detail: "configured sandboxes exceed the node's available storage",
        });
      }

      const updated = yield* requireNode(
        writeConfiguration({
          organizationId,
          nodeId: node.id,
          vmCount: input.vm_count,
          sandboxCpuCount: input.sandbox_cpu_count,
          sandboxMemoryBytes: input.sandbox_memory_bytes,
          sandboxStorageBytes: input.sandbox_storage_bytes,
        }).pipe(persistenceError("updateConfiguration")),
        nodeId,
      );
      yield* runtime.reconcileNodeWarmPool(node.id);
      return yield* output(updated);
    });

    const deleteNode = Effect.fn("Nodes.delete")(function* (
      organizationId: OrganizationId,
      nodeId: NodeId,
    ) {
      const node = yield* getEnrolledRecord(organizationId, nodeId);
      const connected = yield* runtime.isConnected(node.id);
      const runningServers = yield* runningServerCount(node.id).pipe(
        persistenceError("delete.countRunningServers"),
      );
      if (runningServers.total > 0) {
        return yield* new NodeConflict({
          detail: "node has running servers; stop or delete them first",
        });
      }
      if (connected) {
        const activeSandboxes = yield* activeSandboxCount(node.id).pipe(
          persistenceError("delete.countActiveSandboxes"),
        );
        if (activeSandboxes.total > 0) {
          return yield* new NodeConflict({ detail: "node has active sandboxes; delete them first" });
        }
      }

      const deletedAt = yield* DateTime.now;
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* softDeleteNodeSandboxes({ nodeId: node.id, deletedAt });
            yield* deleteCredential(node.id);
          }),
        )
        .pipe(persistenceError("delete.transaction"));
      yield* runtime.disconnect(node.id);
    });

    const applyMetadata = Effect.fn("Nodes.applyMetadata")(function* (
      nodeId: NodeId,
      metadata: NodeMetadataInput,
    ) {
      const updated = yield* writeMetadata(metadataWrite(nodeId, metadata)).pipe(
        persistenceError("applyMetadata"),
      );
      if (Option.isNone(updated)) {
        return yield* new NodeNotFound({ nodeId });
      }
    });

    const connect = Effect.fn("Nodes.connect")(function* (
      nodeId: NodeId,
      authorization: string | undefined,
      metadata: NodeMetadataInput,
    ) {
      const rejected = new NodeConnectionRejected({ detail: "invalid node credential" });
      const token = yield* Option.match(parseBearerToken(authorization), {
        onNone: () => Effect.fail(rejected),
        onSome: Effect.succeed,
      });
      const tokenHash = hashToken(token);
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const credential = yield* credentialMatches({ nodeId, tokenHash }).pipe(
              persistenceError("connect.credential"),
            );
            if (Option.isNone(credential)) {
              return yield* rejected;
            }
            const updated = yield* writeMetadata(metadataWrite(nodeId, metadata)).pipe(
              persistenceError("connect.metadata"),
            );
            if (Option.isNone(updated)) {
              return yield* rejected;
            }
          }),
        )
        .pipe(Effect.catchTag("SqlError", (cause) =>
          new NodePersistenceError({ operation: "connect.transaction", cause }),
        ));
    });

    return NodeService.of({
      list,
      get,
      enroll,
      updateConfiguration,
      delete: deleteNode,
      applyMetadata,
      connect,
    });
  }),
);
