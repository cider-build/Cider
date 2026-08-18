import { Schema } from "effect";

import { NodeId } from "../../domain/ids.ts";

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const NodeMetadataInput = Schema.Struct({
  hardware_model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  chip: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  macos_version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  cpu_count: PositiveInt,
  memory_bytes: PositiveInt,
  storage_total_bytes: PositiveInt,
  storage_available_bytes: NonNegativeInt,
  default_sandbox_cpu_count: PositiveInt,
  default_sandbox_memory_bytes: PositiveInt,
  default_sandbox_storage_bytes: PositiveInt,
});

export type NodeMetadataInput = Schema.Schema.Type<typeof NodeMetadataInput>;

export const NodeMetadata = Schema.Struct({
  hardware_model: NodeMetadataInput.fields.hardware_model,
  chip: NodeMetadataInput.fields.chip,
  macos_version: NodeMetadataInput.fields.macos_version,
  cpu_count: NodeMetadataInput.fields.cpu_count,
  memory_bytes: NodeMetadataInput.fields.memory_bytes,
  storage_total_bytes: NodeMetadataInput.fields.storage_total_bytes,
  storage_available_bytes: NodeMetadataInput.fields.storage_available_bytes,
});

export type NodeMetadata = Schema.Schema.Type<typeof NodeMetadata>;

export const NodeConfigurationInput = Schema.Struct({
  vm_count: Schema.Union([Schema.Literal(1), Schema.Literal(2)]),
  sandbox_cpu_count: PositiveInt,
  sandbox_memory_bytes: PositiveInt,
  sandbox_storage_bytes: PositiveInt,
});

export type NodeConfigurationInput = Schema.Schema.Type<typeof NodeConfigurationInput>;

export const NodeEnrollmentInput = Schema.Struct({
  name: Schema.Trim.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
});

export type NodeEnrollmentInput = Schema.Schema.Type<typeof NodeEnrollmentInput>;

export const NodeOutput = Schema.Struct({
  id: NodeId,
  name: Schema.String,
  connected: Schema.Boolean,
  metadata: Schema.NullOr(NodeMetadata),
  configuration: Schema.NullOr(NodeConfigurationInput),
});

export type NodeOutput = Schema.Schema.Type<typeof NodeOutput>;

export const NodePage = Schema.Struct({
  items: Schema.Array(NodeOutput),
  page: PositiveInt,
  pages: PositiveInt,
  total: NonNegativeInt,
});

export type NodePage = Schema.Schema.Type<typeof NodePage>;

export const NodeEnrollmentOutput = Schema.Struct({
  id: NodeId,
  name: Schema.String,
  token: Schema.String,
});

export type NodeEnrollmentOutput = Schema.Schema.Type<typeof NodeEnrollmentOutput>;
