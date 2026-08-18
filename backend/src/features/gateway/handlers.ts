import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { NotFound } from "../../http/errors.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import { SshTargets } from "./ssh-targets.ts";

export const SshHandlers = HttpApiBuilder.group(
  CiderApi,
  "ssh",
  Effect.fn("SshHandlers")(function* (handlers) {
    const targets = yield* SshTargets;

    return handlers.handleAll({
      list: Effect.fn(function* () {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* targets.available(organizationId).pipe(Effect.orDie);
      }),
      select: Effect.fn(function* ({ payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        const selected = yield* targets
          .select(organizationId, payload.sandbox_id)
          .pipe(Effect.orDie);
        return yield* Option.match(selected, {
          onNone: () => new NotFound({ detail: "sandbox not found or unavailable" }),
          onSome: Effect.succeed,
        });
      }),
    });
  }),
);
