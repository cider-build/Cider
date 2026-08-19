import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { NotFound } from "../../http/errors.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import { type MetricResourceNotFound, Metrics, type MetricsPersistenceError } from "./service.ts";

const metricErrors = <A, R>(
  effect: Effect.Effect<A, MetricResourceNotFound | MetricsPersistenceError, R>,
) =>
  effect.pipe(
    Effect.catchTags({
      "Metrics.ResourceNotFound": (error) =>
        new NotFound({ detail: `${error.resourceKind} not found` }),
      "Metrics.PersistenceError": Effect.die,
    }),
  );

export const MetricsHandlers = HttpApiBuilder.group(
  CiderApi,
  "metrics",
  Effect.fn("MetricsHandlers")(function* (handlers) {
    const metrics = yield* Metrics;

    return handlers.handleAll({
      sandbox: Effect.fn(function* ({ params, query }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* metrics
          .history(organizationId, "sandbox", params.sandbox_id, query.window ?? "live")
          .pipe(metricErrors);
      }),
      server: Effect.fn(function* ({ params, query }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* metrics
          .history(organizationId, "server", params.server_id, query.window ?? "live")
          .pipe(metricErrors);
      }),
    });
  }),
);
