import { Schema } from "effect";

import {
  NodeId,
  OrganizationId,
  SandboxId,
  ServerId,
  SnapshotId,
} from "../../domain/ids.ts";

export const SandboxState = Schema.Literals([
  "warm",
  "provisioning",
  "active",
  "pausing",
  "paused",
  "restoring",
  "stopped",
]);
export type SandboxState = typeof SandboxState.Type;

export const LaunchConfiguration = Schema.Struct({
  resources: Schema.optionalKey(
    Schema.Struct({
      min_storage: Schema.optionalKey(
        Schema.Union([
          Schema.Int.check(Schema.isGreaterThan(0)),
          Schema.String.check(
            Schema.isPattern(/^\s*[0-9]+(?:\.[0-9]+)?\s*(?:kb|mb|gb|tb)\s*$/i),
          ),
        ]),
      ),
    }),
  ),
  setup: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  ),
  start: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type LaunchConfiguration = typeof LaunchConfiguration.Type;

export const ServerState = Schema.Literals([
  "provisioning",
  "running",
  "stopping",
  "stopped",
  "failed",
]);
export type ServerState = typeof ServerState.Type;

export const ServerConfiguration = Schema.Struct({
  image: Schema.NonEmptyString,
  software: Schema.Array(Schema.String),
  channels: Schema.Array(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  setup: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  ),
  start: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ServerConfiguration = typeof ServerConfiguration.Type;

export const CommandResult = Schema.Struct({
  output: Schema.String,
});

export type CommandResult = typeof CommandResult.Type;

const nullableDateTime = Schema.NullOr(Schema.DateTimeUtc);
const nullableStorage = Schema.NullOr(
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
);

export const SandboxView = Schema.Struct({
  id: SandboxId,
  node_id: NodeId,
  node_name: Schema.String,
  storage_used_bytes: nullableStorage,
  status: SandboxState,
  created_at: Schema.DateTimeUtc,
  deleted_at: nullableDateTime,
});
export type SandboxView = Schema.Schema.Type<typeof SandboxView>;

export const SandboxRecord = Schema.Struct({
  id: SandboxId,
  node_id: NodeId,
  launch_config: Schema.NullOr(LaunchConfiguration),
  storage_used_bytes: nullableStorage,
  status: SandboxState,
  created_at: Schema.DateTimeUtc,
  deleted_at: nullableDateTime,
});
export type SandboxRecord = Schema.Schema.Type<typeof SandboxRecord>;

export const ExecuteInput = Schema.Struct({
  command: Schema.String,
});
export type ExecuteInput = Schema.Schema.Type<typeof ExecuteInput>;

export const ResumeInput = Schema.Struct({
  node_id: Schema.optionalKey(Schema.NullOr(NodeId)),
});
export type ResumeInput = Schema.Schema.Type<typeof ResumeInput>;

export const ServerName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(63),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/),
);

export const ServerConfigurationInput = Schema.Struct({
  image: Schema.optionalKey(Schema.NonEmptyString),
  software: Schema.optionalKey(Schema.Array(Schema.String)),
  channels: Schema.optionalKey(Schema.Array(Schema.String)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  setup: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  ),
  start: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ServerConfigurationInput = Schema.Schema.Type<
  typeof ServerConfigurationInput
>;

export const CreateServerInput = Schema.Struct({
  name: ServerName,
  node_id: Schema.optionalKey(Schema.NullOr(NodeId)),
  config: Schema.optionalKey(Schema.NullOr(ServerConfigurationInput)),
});
export type CreateServerInput = Schema.Schema.Type<typeof CreateServerInput>;

export const ServerView = Schema.Struct({
  id: ServerId,
  name: Schema.String,
  node_id: NodeId,
  node_name: Schema.String,
  status: ServerState,
  status_detail: Schema.NullOr(Schema.String),
  storage_used_bytes: nullableStorage,
  config: Schema.NullOr(ServerConfiguration),
  created_at: Schema.DateTimeUtc,
  deleted_at: nullableDateTime,
});
export type ServerView = Schema.Schema.Type<typeof ServerView>;

export const RestoreInput = Schema.Struct({
  node_id: Schema.optionalKey(Schema.NullOr(NodeId)),
});
export type RestoreInput = Schema.Schema.Type<typeof RestoreInput>;

export const SnapshotView = Schema.Struct({
  id: SnapshotId,
  source_sandbox_id: SandboxId,
  created_at: Schema.DateTimeUtc,
  deleted_at: nullableDateTime,
  size_bytes: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
});
export type SnapshotView = Schema.Schema.Type<typeof SnapshotView>;

export const CreatedSnapshotView = Schema.Struct({
  id: SnapshotId,
  source_sandbox_id: SandboxId,
  org_id: OrganizationId,
  launch_config: Schema.NullOr(LaunchConfiguration),
  created_at: Schema.DateTimeUtc,
  deleted_at: nullableDateTime,
});
export type CreatedSnapshotView = Schema.Schema.Type<typeof CreatedSnapshotView>;

export const NodeVmState = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});
export type NodeVmState = Schema.Schema.Type<typeof NodeVmState>;

export const NodeVmList = Schema.Array(NodeVmState);

export const StorageUsageResponse = Schema.Struct({
  used_bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const PortableSnapshotResponse = Schema.Struct({
  manifest: Schema.Json,
});

export const CreatedVmResponse = Schema.Struct({
  id: Schema.String,
});

export const CreateSandboxUpload = Schema.Struct({
  bytes: Schema.Uint8Array,
  filename: Schema.String,
  contentType: Schema.String,
});
export type CreateSandboxUpload = Schema.Schema.Type<typeof CreateSandboxUpload>;
