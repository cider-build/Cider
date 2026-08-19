import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";

import { SshApi } from "../features/gateway/api.ts";
import { SandboxesApi, ServersApi, SnapshotsApi } from "../features/machines/api.ts";
import { MetricsApi } from "../features/metrics/api.ts";
import { NodeStorageApi } from "../features/node-storage/api.ts";
import { NodesApi } from "../features/nodes/api.ts";
import { WaitlistApi } from "../features/waitlist/api.ts";
import { ServiceUnavailable } from "./errors.ts";
import { RequestValidation } from "./middleware.ts";

export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
});
export type HealthResponse = typeof HealthResponse.Type;

export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", {
    success: HealthResponse,
    error: ServiceUnavailable,
  }),
) {}

export class CiderApi extends HttpApi.make("cider")
  .add(SystemApi)
  .add(NodesApi)
  .add(SandboxesApi)
  .add(ServersApi)
  .add(SnapshotsApi)
  .add(MetricsApi)
  .add(SshApi)
  .add(NodeStorageApi)
  .add(WaitlistApi)
  .middleware(RequestValidation)
  .annotateMerge(
    OpenApi.annotations({
      title: "Cider API",
      version: "0.1.0",
      description: "Cider control-plane API",
    }),
  ) {}
