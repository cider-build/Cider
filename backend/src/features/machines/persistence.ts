import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import {
  NodeId,
  OrganizationId,
  SandboxId,
  ServerId,
  SnapshotId,
  VmId,
} from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import {
  LaunchConfiguration,
  type SandboxRecord,
  SandboxState,
  type SandboxView,
  ServerConfiguration,
  ServerState,
  type ServerView,
} from "./contracts.ts";
import {
  type MachineNotFound,
  type MachinePersistenceError,
  machinePersistenceError,
  notFound,
} from "./errors.ts";

const databaseJson = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(Schema.fromJsonString(Schema.toCodecJson(schema)));

const SandboxDatabaseRow = Schema.Struct({
  id: SandboxId,
  vmId: VmId,
  nodeId: NodeId,
  nodeName: Schema.String,
  organizationId: Schema.NullOr(OrganizationId),
  launchConfiguration: databaseJson(LaunchConfiguration),
  storageUsedBytes: Schema.NullOr(Schema.Int),
  state: SandboxState,
  expiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString,
  deletedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
type SandboxDatabaseRow = typeof SandboxDatabaseRow.Type;

const ServerDatabaseRow = Schema.Struct({
  id: ServerId,
  vmId: Schema.NullOr(VmId),
  organizationId: OrganizationId,
  nodeId: NodeId,
  nodeName: Schema.String,
  name: Schema.String,
  configuration: Schema.fromJsonString(Schema.toCodecJson(ServerConfiguration)),
  storageUsedBytes: Schema.NullOr(Schema.Int),
  state: ServerState,
  statusDetail: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  deletedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type ServerDatabaseRow = typeof ServerDatabaseRow.Type;

const SnapshotDatabaseRow = Schema.Struct({
  id: SnapshotId,
  sourceSandboxId: SandboxId,
  organizationId: OrganizationId,
  launchConfiguration: databaseJson(LaunchConfiguration),
  createdAt: Schema.DateTimeUtcFromString,
  deletedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type SnapshotDatabaseRow = typeof SnapshotDatabaseRow.Type;

const SandboxLookup = Schema.Struct({
  id: SandboxId,
  organizationId: OrganizationId,
});
const ServerLookup = Schema.Struct({
  id: ServerId,
  organizationId: OrganizationId,
});
const SnapshotLookup = Schema.Struct({
  id: SnapshotId,
  organizationId: OrganizationId,
});
const OrganizationList = Schema.Struct({
  organizationId: OrganizationId,
  includeDeleted: Schema.Boolean,
});

const sandboxView = (row: SandboxDatabaseRow): SandboxView => ({
  id: row.id,
  node_id: row.nodeId,
  node_name: row.nodeName,
  storage_used_bytes: row.storageUsedBytes,
  status: row.state,
  created_at: row.createdAt,
  deleted_at: row.deletedAt,
});

const sandboxRecord = (row: SandboxDatabaseRow): SandboxRecord => ({
  id: row.id,
  node_id: row.nodeId,
  launch_config: row.launchConfiguration,
  storage_used_bytes: row.storageUsedBytes,
  status: row.state,
  created_at: row.createdAt,
  deleted_at: row.deletedAt,
});

const serverView = (row: ServerDatabaseRow): ServerView => ({
  id: row.id,
  name: row.name,
  node_id: row.nodeId,
  node_name: row.nodeName,
  status: row.state,
  status_detail: row.statusDetail,
  storage_used_bytes: row.storageUsedBytes,
  config: row.configuration,
  created_at: row.createdAt,
  deleted_at: row.deletedAt,
});

const persistenceError = machinePersistenceError;

type ReadError = MachinePersistenceError | MachineNotFound;

export interface MachinePersistenceApi {
  readonly listSandboxes: (
    organizationId: OrganizationId,
  ) => Effect.Effect<ReadonlyArray<SandboxView>, MachinePersistenceError>;
  readonly getSandbox: (
    id: SandboxId,
    organizationId: OrganizationId,
    includeDeleted: boolean,
  ) => Effect.Effect<SandboxRecord, ReadError>;
  readonly getSandboxView: (
    id: SandboxId,
    organizationId: OrganizationId,
  ) => Effect.Effect<SandboxView, ReadError>;
  readonly insertSandbox: (input: {
    readonly id: SandboxId;
    readonly vmId: VmId;
    readonly nodeId: NodeId;
    readonly organizationId: OrganizationId;
    readonly launchConfiguration: LaunchConfiguration | null;
    readonly state: SandboxState;
  }) => Effect.Effect<SandboxRecord, ReadError>;
  readonly setSandbox: (
    id: SandboxId,
    organizationId: OrganizationId,
    values: {
      readonly nodeId?: NodeId;
      readonly state?: SandboxState;
      readonly launchConfiguration?: LaunchConfiguration | null;
      readonly storageUsedBytes?: number | null;
      readonly createdAt?: DateTime.Utc;
      readonly deletedAt?: DateTime.Utc;
    },
  ) => Effect.Effect<SandboxRecord, ReadError>;
  readonly listServers: (
    organizationId: OrganizationId,
    includeDeleted: boolean,
  ) => Effect.Effect<ReadonlyArray<ServerView>, MachinePersistenceError>;
  readonly getServer: (
    id: ServerId,
    organizationId: OrganizationId,
  ) => Effect.Effect<ServerDatabaseRow, ReadError>;
  readonly findActiveServerByName: (
    organizationId: OrganizationId,
    name: string,
  ) => Effect.Effect<Option.Option<ServerDatabaseRow>, MachinePersistenceError>;
  readonly findServer: (
    id: ServerId,
  ) => Effect.Effect<Option.Option<ServerDatabaseRow>, MachinePersistenceError>;
  readonly insertServer: (input: {
    readonly organizationId: OrganizationId;
    readonly nodeId: NodeId;
    readonly name: string;
    readonly vmId: VmId | null;
    readonly configuration: ServerConfiguration;
    readonly state: ServerState;
  }) => Effect.Effect<ServerDatabaseRow, ReadError>;
  readonly setServer: (
    id: ServerId,
    values: {
      readonly vmId?: VmId;
      readonly nodeId?: NodeId;
      readonly state?: ServerState;
      readonly statusDetail?: string | null;
      readonly storageUsedBytes?: number;
      readonly deletedAt?: DateTime.Utc;
    },
  ) => Effect.Effect<Option.Option<ServerDatabaseRow>, MachinePersistenceError>;
  readonly listSnapshots: (
    organizationId: OrganizationId,
    includeDeleted: boolean,
  ) => Effect.Effect<ReadonlyArray<SnapshotDatabaseRow>, MachinePersistenceError>;
  readonly getSnapshot: (
    id: SnapshotId,
    organizationId: OrganizationId,
  ) => Effect.Effect<SnapshotDatabaseRow, ReadError>;
  readonly saveSnapshot: (input: {
    readonly id: SnapshotId;
    readonly sourceSandboxId: SandboxId;
    readonly organizationId: OrganizationId;
    readonly launchConfiguration: LaunchConfiguration | null;
  }) => Effect.Effect<SnapshotDatabaseRow, ReadError>;
  readonly deleteSnapshot: (
    id: SnapshotId,
    organizationId: OrganizationId,
    deletedAt: DateTime.Utc,
  ) => Effect.Effect<void, MachinePersistenceError>;
  readonly toServerView: (row: ServerDatabaseRow) => ServerView;
}

export class MachinePersistence extends Context.Service<
  MachinePersistence,
  MachinePersistenceApi
>()("cider/features/machines/MachinePersistence") {
  static readonly layer = Layer.effect(
    MachinePersistence,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ids = yield* IdGenerator;

      const sandboxById = SqlSchema.findOneOption({
        Request: SandboxLookup,
        Result: SandboxDatabaseRow,
        execute: ({ id, organizationId }) => sql`
          SELECT s.*, n.name AS node_name
          FROM sandbox s JOIN node n ON n.id = s.node_id
          WHERE s.id = ${id} AND s.organization_id = ${organizationId}
        `,
      });
      const serverById = SqlSchema.findOneOption({
        Request: ServerLookup,
        Result: ServerDatabaseRow,
        execute: ({ id, organizationId }) => sql`
          SELECT s.*, n.name AS node_name
          FROM server s JOIN node n ON n.id = s.node_id
          WHERE s.id = ${id} AND s.organization_id = ${organizationId}
        `,
      });
      const serverByIdOnly = SqlSchema.findOneOption({
        Request: ServerId,
        Result: ServerDatabaseRow,
        execute: (id) => sql`
          SELECT s.*, n.name AS node_name
          FROM server s JOIN node n ON n.id = s.node_id
          WHERE s.id = ${id}
        `,
      });
      const activeServerByName = SqlSchema.findOneOption({
        Request: Schema.Struct({ organizationId: OrganizationId, name: Schema.String }),
        Result: ServerDatabaseRow,
        execute: ({ organizationId, name }) => sql`
          SELECT s.*, n.name AS node_name
          FROM server s JOIN node n ON n.id = s.node_id
          WHERE s.organization_id = ${organizationId}
            AND s.name = ${name}
            AND s.deleted_at IS NULL
        `,
      });
      const snapshotById = SqlSchema.findOneOption({
        Request: SnapshotLookup,
        Result: SnapshotDatabaseRow,
        execute: ({ id, organizationId }) => sql`
          SELECT * FROM snapshot
          WHERE id = ${id} AND organization_id = ${organizationId}
        `,
      });

      const listSandboxesQuery = SqlSchema.findAll({
        Request: OrganizationId,
        Result: SandboxDatabaseRow,
        execute: (organizationId) => sql`
          SELECT s.*, n.name AS node_name
          FROM sandbox s JOIN node n ON n.id = s.node_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC
        `,
      });
      const listServersQuery = SqlSchema.findAll({
        Request: OrganizationList,
        Result: ServerDatabaseRow,
        execute: ({ organizationId, includeDeleted }) =>
          includeDeleted
            ? sql`
              SELECT s.*, n.name AS node_name
              FROM server s JOIN node n ON n.id = s.node_id
              WHERE s.organization_id = ${organizationId}
              ORDER BY s.created_at DESC
            `
            : sql`
              SELECT s.*, n.name AS node_name
              FROM server s JOIN node n ON n.id = s.node_id
              WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
              ORDER BY s.created_at DESC
            `,
      });
      const listSnapshotsQuery = SqlSchema.findAll({
        Request: OrganizationList,
        Result: SnapshotDatabaseRow,
        execute: ({ organizationId, includeDeleted }) =>
          includeDeleted
            ? sql`
              SELECT * FROM snapshot
              WHERE organization_id = ${organizationId}
              ORDER BY created_at DESC
            `
            : sql`
              SELECT * FROM snapshot
              WHERE organization_id = ${organizationId} AND deleted_at IS NULL
              ORDER BY created_at DESC
            `,
      });

      const listSandboxes = Effect.fn("MachinePersistence.listSandboxes")(
        (organizationId: OrganizationId) =>
          listSandboxesQuery(organizationId).pipe(
            Effect.map((rows) => rows.map(sandboxView)),
            persistenceError("MachinePersistence.listSandboxes"),
          ),
      );

      const getSandbox = Effect.fn("MachinePersistence.getSandbox")(
        (id: SandboxId, organizationId: OrganizationId, includeDeleted: boolean) =>
          sandboxById({ id, organizationId }).pipe(
            persistenceError("MachinePersistence.getSandbox"),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(notFound("sandbox not found")),
                onSome: (row) =>
                  row.deletedAt !== null && !includeDeleted
                    ? Effect.fail(notFound("sandbox not found"))
                    : Effect.succeed(sandboxRecord(row)),
              }),
            ),
          ),
      );

      const getSandboxView = Effect.fn("MachinePersistence.getSandboxView")(
        (id: SandboxId, organizationId: OrganizationId) =>
          sandboxById({ id, organizationId }).pipe(
            persistenceError("MachinePersistence.getSandboxView"),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    notFound("sandbox not found"),
                  ),
                onSome: (row) =>
                  row.deletedAt === null
                    ? Effect.succeed(sandboxView(row))
                    : Effect.fail(
                        notFound("sandbox not found"),
                      ),
              }),
            ),
          ),
      );

      const insertSandbox = Effect.fn("MachinePersistence.insertSandbox")(function* (
        input: Parameters<MachinePersistenceApi["insertSandbox"]>[0],
      ) {
        const now = yield* DateTime.now;
        yield* sql`
          INSERT INTO sandbox (
            id, vm_id, node_id, organization_id, launch_configuration,
            storage_used_bytes, state, expires_at, created_at, deleted_at
          ) VALUES (
            ${input.id}, ${input.vmId}, ${input.nodeId}, ${input.organizationId},
            ${input.launchConfiguration === null ? null : JSON.stringify(input.launchConfiguration)},
            NULL, ${input.state}, NULL, ${DateTime.formatIso(now)}, NULL
          )
        `.pipe(persistenceError("MachinePersistence.insertSandbox"));
        return yield* getSandbox(input.id, input.organizationId, false);
      });

      const setSandbox = Effect.fn("MachinePersistence.setSandbox")(function* (
        id: SandboxId,
        organizationId: OrganizationId,
        values: Parameters<MachinePersistenceApi["setSandbox"]>[2],
      ) {
        const update: Record<string, string | number | null> = {};
        if (values.nodeId !== undefined) update.nodeId = values.nodeId;
        if (values.state !== undefined) update.state = values.state;
        if (values.launchConfiguration !== undefined) {
          update.launchConfiguration
            = values.launchConfiguration === null
              ? null
              : JSON.stringify(values.launchConfiguration);
        }
        if (values.storageUsedBytes !== undefined) {
          update.storageUsedBytes = values.storageUsedBytes;
        }
        if (values.createdAt !== undefined) {
          update.createdAt = DateTime.formatIso(values.createdAt);
        }
        if (values.deletedAt !== undefined) {
          update.deletedAt = DateTime.formatIso(values.deletedAt);
        }
        if (Object.keys(update).length === 0) {
          return yield* getSandbox(id, organizationId, false);
        }
        const updated = yield* sql`
          UPDATE sandbox SET ${sql.update(update)}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND deleted_at IS NULL
          RETURNING id
        `.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: SandboxId }))),
                ),
                persistenceError("MachinePersistence.setSandbox"),
              );
        if (updated.length === 0) {
          return yield* notFound("sandbox not found");
        }
        return yield* getSandbox(
          id,
          organizationId,
          values.deletedAt !== undefined,
        );
      });

      const listServers = Effect.fn("MachinePersistence.listServers")(
        (organizationId: OrganizationId, includeDeleted: boolean) =>
          listServersQuery({ organizationId, includeDeleted }).pipe(
            Effect.map((rows) => rows.map(serverView)),
            persistenceError("MachinePersistence.listServers"),
          ),
      );

      const getServer = Effect.fn("MachinePersistence.getServer")(
        (id: ServerId, organizationId: OrganizationId) =>
          serverById({ id, organizationId }).pipe(
            persistenceError("MachinePersistence.getServer"),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(notFound("server not found")),
                onSome: (row) =>
                  row.deletedAt === null
                    ? Effect.succeed(row)
                    : Effect.fail(notFound("server not found")),
              }),
            ),
          ),
      );

      const findActiveServerByName = Effect.fn(
        "MachinePersistence.findActiveServerByName",
      )((organizationId: OrganizationId, name: string) =>
        activeServerByName({ organizationId, name }).pipe(
          persistenceError("MachinePersistence.findActiveServerByName"),
        ),
      );

      const findServer = Effect.fn("MachinePersistence.findServer")((id: ServerId) =>
        serverByIdOnly(id).pipe(
          Effect.map(Option.filter((row) => row.deletedAt === null)),
          persistenceError("MachinePersistence.findServer"),
        ),
      );

      const insertServer = Effect.fn("MachinePersistence.insertServer")(function* (
        input: Parameters<MachinePersistenceApi["insertServer"]>[0],
      ) {
        const id = ServerId.make(yield* ids.uuid);
        const now = yield* DateTime.now;
        yield* sql`
          INSERT INTO server (
            id, vm_id, organization_id, node_id, name, configuration,
            storage_used_bytes, state, status_detail, created_at, deleted_at
          ) VALUES (
            ${id}, ${input.vmId}, ${input.organizationId}, ${input.nodeId}, ${input.name},
            ${JSON.stringify(input.configuration)}, NULL, ${input.state}, NULL,
            ${DateTime.formatIso(now)}, NULL
          )
        `.pipe(persistenceError("MachinePersistence.insertServer"));
        return yield* getServer(id, input.organizationId);
      });

      const setServer = Effect.fn("MachinePersistence.setServer")(function* (
        id: ServerId,
        values: Parameters<MachinePersistenceApi["setServer"]>[1],
      ) {
        const readCurrent = () =>
          serverByIdOnly(id).pipe(persistenceError("MachinePersistence.setServer.read"));
        const update: Record<string, string | number | null> = {};
        if (values.vmId !== undefined) update.vmId = values.vmId;
        if (values.nodeId !== undefined) update.nodeId = values.nodeId;
        if (values.state !== undefined) update.state = values.state;
        if (values.statusDetail !== undefined) {
          update.statusDetail = values.statusDetail;
        }
        if (values.storageUsedBytes !== undefined) {
          update.storageUsedBytes = values.storageUsedBytes;
        }
        if (values.deletedAt !== undefined) {
          update.deletedAt = DateTime.formatIso(values.deletedAt);
        }
        if (Object.keys(update).length === 0) {
          return yield* findServer(id);
        }
        const updated = yield* sql`
          UPDATE server SET ${sql.update(update)}
          WHERE id = ${id} AND deleted_at IS NULL
          RETURNING id
        `.pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: ServerId }))),
              ),
              persistenceError("MachinePersistence.setServer.write"),
            );
        return updated.length === 0 ? Option.none() : yield* readCurrent();
      });

      const listSnapshots = Effect.fn("MachinePersistence.listSnapshots")(
        (organizationId: OrganizationId, includeDeleted: boolean) =>
          listSnapshotsQuery({ organizationId, includeDeleted }).pipe(
            persistenceError("MachinePersistence.listSnapshots"),
          ),
      );

      const getSnapshot = Effect.fn("MachinePersistence.getSnapshot")(
        (id: SnapshotId, organizationId: OrganizationId) =>
          snapshotById({ id, organizationId }).pipe(
            persistenceError("MachinePersistence.getSnapshot"),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(notFound("snapshot not found")),
                onSome: (row) =>
                  row.deletedAt === null
                    ? Effect.succeed(row)
                    : Effect.fail(notFound("snapshot not found")),
              }),
            ),
          ),
      );

      const saveSnapshot = Effect.fn("MachinePersistence.saveSnapshot")(function* (
        input: Parameters<MachinePersistenceApi["saveSnapshot"]>[0],
      ) {
        const now = yield* DateTime.now;
        yield* Effect.gen(function* () {
          yield* sql`
            INSERT INTO snapshot (
              id, source_sandbox_id, organization_id, launch_configuration,
              created_at, deleted_at
            ) VALUES (
              ${input.id}, ${input.sourceSandboxId}, ${input.organizationId},
              ${input.launchConfiguration === null ? null : JSON.stringify(input.launchConfiguration)},
              ${DateTime.formatIso(now)}, NULL
            )
          `;
          yield* sql`
            UPDATE sandbox SET state = 'stopped'
            WHERE id = ${input.sourceSandboxId}
              AND organization_id = ${input.organizationId}
              AND deleted_at IS NULL
          `;
        }).pipe(
          sql.withTransaction,
          persistenceError("MachinePersistence.saveSnapshot"),
        );
        return yield* getSnapshot(input.id, input.organizationId);
      });

      const deleteSnapshot = Effect.fn("MachinePersistence.deleteSnapshot")(
        (id: SnapshotId, organizationId: OrganizationId, deletedAt: DateTime.Utc) =>
          sql`
            UPDATE snapshot SET deleted_at = ${DateTime.formatIso(deletedAt)}
            WHERE id = ${id} AND organization_id = ${organizationId} AND deleted_at IS NULL
          `.pipe(
                Effect.asVoid,
                persistenceError("MachinePersistence.deleteSnapshot"),
              ),
      );

      return MachinePersistence.of({
        listSandboxes,
        getSandbox,
        getSandboxView,
        insertSandbox,
        setSandbox,
        listServers,
        getServer,
        findActiveServerByName,
        findServer,
        insertServer,
        setServer,
        listSnapshots,
        getSnapshot,
        saveSnapshot,
        deleteSnapshot,
        toServerView: serverView,
      });
    }),
  );
}
