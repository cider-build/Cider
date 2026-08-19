import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { NodeId, SandboxId } from "../../domain/ids.ts";
import { NotFound } from "../../http/errors.ts";
import { Authorization } from "../../http/middleware.ts";

export const SshTarget = Schema.Struct({
  sandbox_id: SandboxId,
  node_id: NodeId,
  node_name: Schema.String,
  status: Schema.String,
  server_name: Schema.NullOr(Schema.String),
});
export type SshTarget = typeof SshTarget.Type;

export const SshSelection = Schema.Struct({ sandbox_id: SandboxId });
export type SshSelection = typeof SshSelection.Type;

export class SshApi extends HttpApiGroup.make("ssh")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(SshTarget),
    }),
    HttpApiEndpoint.post("select", "/", {
      payload: SshSelection,
      success: SshTarget,
      error: NotFound,
    }),
  )
  .middleware(Authorization)
  .prefix("/ssh")
  .annotateMerge(
    OpenApi.annotations({
      title: "SSH",
      description: "SSH targets available for terminal connections",
    }),
  ) {}
