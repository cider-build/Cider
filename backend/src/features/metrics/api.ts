import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { Schema } from "effect";

import { SandboxId, ServerId } from "../../domain/ids.ts";
import { NotFound } from "../../http/errors.ts";
import { Authorization } from "../../http/middleware.ts";
import { MetricHistory, MetricWindow } from "./contracts.ts";

const WindowQuery = { window: Schema.optional(MetricWindow) };

export class MetricsApi extends HttpApiGroup.make("metrics")
  .add(
    HttpApiEndpoint.get("sandbox", "/sandboxes/:sandbox_id/metrics", {
      params: { sandbox_id: SandboxId },
      query: WindowQuery,
      success: MetricHistory,
      error: NotFound,
    }),
    HttpApiEndpoint.get("server", "/servers/:server_id/metrics", {
      params: { server_id: ServerId },
      query: WindowQuery,
      success: MetricHistory,
      error: NotFound,
    }),
  )
  .middleware(Authorization)
  .annotateMerge(
    OpenApi.annotations({
      title: "Metrics",
      description: "Resource usage history for sandboxes and servers",
    }),
  ) {}
