import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import { machineErrors } from "./http.ts";
import { ServerService } from "./server-service.ts";

export const ServersHandlers = HttpApiBuilder.group(
  CiderApi,
  "servers",
  Effect.fn("ServersHandlers")(function* (handlers) {
    const servers = yield* ServerService;

    return handlers.handleAll({
      list: Effect.fn(function* ({ query }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers
          .list(organizationId, query.include_deleted ?? false)
          .pipe(Effect.orDie);
      }),
      create: Effect.fn(function* ({ payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers.create(organizationId, payload).pipe(machineErrors);
      }),
      get: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers.get(organizationId, params.server_id).pipe(machineErrors);
      }),
      stop: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers.stop(organizationId, params.server_id).pipe(machineErrors);
      }),
      start: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers.start(organizationId, params.server_id).pipe(machineErrors);
      }),
      retry: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* servers.retry(organizationId, params.server_id).pipe(machineErrors);
      }),
      delete: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        yield* servers.delete(organizationId, params.server_id).pipe(machineErrors);
      }),
    });
  }),
);
