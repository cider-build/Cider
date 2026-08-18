import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { SqlClient } from "effect/unstable/sql";

import { CiderApi, HealthResponse } from "./api.ts";
import { ServiceUnavailable } from "./errors.ts";

export const SystemHandlers = HttpApiBuilder.group(
  CiderApi,
  "system",
  Effect.fn("SystemHandlers")(function* (handlers) {
    const sql = yield* SqlClient.SqlClient;

    return handlers.handle("health", () =>
      sql`SELECT 1 AS healthy`.pipe(
        Effect.as(HealthResponse.make({ status: "ok" })),
        Effect.tapError((cause) => Effect.logError("Database health check failed", cause)),
        Effect.mapError(() => new ServiceUnavailable({ detail: "Database health check failed" })),
      ),
    );
  }),
);
