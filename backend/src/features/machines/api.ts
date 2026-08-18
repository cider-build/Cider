import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";

import { NodeId, SandboxId, ServerId, SnapshotId } from "../../domain/ids.ts";
import {
  BadRequest,
  Conflict,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  UnprocessableContent,
} from "../../http/errors.ts";
import { Authorization } from "../../http/middleware.ts";
import {
  CommandResult,
  CreatedSnapshotView,
  CreateServerInput,
  ExecuteInput,
  RestoreInput,
  ResumeInput,
  SandboxView,
  ServerView,
  SnapshotView,
} from "./contracts.ts";

export const MachineErrors = [
  NotFound,
  Conflict,
  UnprocessableContent,
  TooManyRequests,
  ServiceUnavailable,
] as const;

const SandboxPath = { sandbox_id: SandboxId };
const ServerPath = { server_id: ServerId };
const SnapshotPath = { snapshot_id: SnapshotId };
const IncludeDeletedQuery = { include_deleted: Schema.optional(Schema.Boolean) };

export const CreateSandboxForm = Schema.Struct({
  node_id: Schema.optional(NodeId),
  archive: Schema.optional(Multipart.SingleFileSchema),
}).pipe(HttpApiSchema.asMultipartStream());

export class SandboxesApi extends HttpApiGroup.make("sandboxes")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(SandboxView),
    }),
    HttpApiEndpoint.get("get", "/:sandbox_id", {
      params: SandboxPath,
      success: SandboxView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: CreateSandboxForm,
      success: SandboxView.pipe(HttpApiSchema.status(201)),
      error: [...MachineErrors, BadRequest],
    }),
    HttpApiEndpoint.post("snapshot", "/:sandbox_id/snapshots", {
      params: SandboxPath,
      success: CreatedSnapshotView.pipe(HttpApiSchema.status(201)),
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("execute", "/:sandbox_id/execute", {
      params: SandboxPath,
      payload: ExecuteInput,
      success: CommandResult,
      error: MachineErrors,
    }),
    HttpApiEndpoint.delete("delete", "/:sandbox_id", {
      params: SandboxPath,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("pause", "/:sandbox_id/pause", {
      params: SandboxPath,
      success: SandboxView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("resume", "/:sandbox_id/resume", {
      params: SandboxPath,
      payload: [ResumeInput, Schema.Null],
      success: SandboxView,
      error: MachineErrors,
    }),
  )
  .middleware(Authorization)
  .prefix("/sandboxes")
  .annotateMerge(
    OpenApi.annotations({
      title: "Sandboxes",
      description: "Sandbox lifecycle operations",
    }),
  ) {}

export class ServersApi extends HttpApiGroup.make("servers")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: IncludeDeletedQuery,
      success: Schema.Array(ServerView),
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: CreateServerInput,
      success: ServerView.pipe(HttpApiSchema.status(201)),
      error: MachineErrors,
    }),
    HttpApiEndpoint.get("get", "/:server_id", {
      params: ServerPath,
      success: ServerView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("stop", "/:server_id/stop", {
      params: ServerPath,
      success: ServerView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("start", "/:server_id/start", {
      params: ServerPath,
      success: ServerView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.post("retry", "/:server_id/retry", {
      params: ServerPath,
      success: ServerView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.delete("delete", "/:server_id", {
      params: ServerPath,
      error: MachineErrors,
    }),
  )
  .middleware(Authorization)
  .prefix("/servers")
  .annotateMerge(
    OpenApi.annotations({
      title: "Servers",
      description: "Server lifecycle operations",
    }),
  ) {}

export class SnapshotsApi extends HttpApiGroup.make("snapshots")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: IncludeDeletedQuery,
      success: Schema.Array(SnapshotView),
    }),
    HttpApiEndpoint.post("restore", "/:snapshot_id/restore", {
      params: SnapshotPath,
      payload: RestoreInput,
      success: SandboxView,
      error: MachineErrors,
    }),
    HttpApiEndpoint.delete("delete", "/:snapshot_id", {
      params: SnapshotPath,
      error: MachineErrors,
    }),
  )
  .middleware(Authorization)
  .prefix("/snapshots")
  .annotateMerge(
    OpenApi.annotations({
      title: "Snapshots",
      description: "Snapshot restore and removal",
    }),
  ) {}
