import { Schema } from "effect";

const controlId = (name: string) =>
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)).pipe(Schema.brand(name));

const machineId = (name: string) =>
  Schema.String.check(Schema.isPattern(/^cider-[0-9a-f]{32}$/)).pipe(Schema.brand(name));

export const OrganizationId = controlId("OrganizationId");
export type OrganizationId = typeof OrganizationId.Type;

export const UserId = controlId("UserId");
export type UserId = typeof UserId.Type;

export const NodeId = controlId("NodeId");
export type NodeId = typeof NodeId.Type;

export const SandboxId = machineId("SandboxId");
export type SandboxId = typeof SandboxId.Type;

export const ServerId = controlId("ServerId");
export type ServerId = typeof ServerId.Type;

export const SnapshotId = controlId("SnapshotId");
export type SnapshotId = typeof SnapshotId.Type;

export const VmId = machineId("VmId");
export type VmId = typeof VmId.Type;

export const RequestId = controlId("RequestId");
export type RequestId = typeof RequestId.Type;

export const TunnelId = controlId("TunnelId");
export type TunnelId = typeof TunnelId.Type;
