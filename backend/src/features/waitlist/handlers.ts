import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { BadRequest } from "../../http/errors.ts";
import { WaitlistService } from "./service.ts";

export const WaitlistHandlers = HttpApiBuilder.group(
  CiderApi,
  "waitlist",
  Effect.fn("WaitlistHandlers")(function* (handlers) {
    const waitlist = yield* WaitlistService;

    return handlers.handle("join", ({ payload }) =>
      waitlist.join(payload).pipe(
        Effect.catchTags({
          "Waitlist.BotVerificationFailed": () =>
            new BadRequest({ detail: "Bot verification failed" }),
          "Waitlist.TurnstileNotConfigured": Effect.die,
          "Waitlist.TurnstileRequestError": Effect.die,
          "Waitlist.WaitlistPersistenceError": Effect.die,
        }),
      ),
    );
  }),
);
