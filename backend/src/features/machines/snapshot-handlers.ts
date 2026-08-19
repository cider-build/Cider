import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import { machineErrors } from "./http.ts";
import { SnapshotService } from "./snapshot-service.ts";

export const SnapshotsHandlers = HttpApiBuilder.group(
  CiderApi,
  "snapshots",
  Effect.fn("SnapshotsHandlers")(function* (handlers) {
    const snapshots = yield* SnapshotService;

    return handlers.handleAll({
      list: Effect.fn(function* ({ query }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* snapshots
          .list(organizationId, query.include_deleted ?? false)
          .pipe(Effect.orDie);
      }),
      restore: Effect.fn(function* ({ params, payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* snapshots
          .restore(organizationId, params.snapshot_id, payload.node_id ?? undefined)
          .pipe(machineErrors);
      }),
      delete: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        yield* snapshots.delete(organizationId, params.snapshot_id).pipe(machineErrors);
      }),
    });
  }),
);
