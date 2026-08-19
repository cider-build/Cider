import { Clock, Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { IdGenerator } from "../../services/id-generator.ts";
import {
  type BotVerificationFailed,
  type TurnstileNotConfigured,
  type TurnstileRequestError,
  WaitlistPersistenceError,
} from "./errors.ts";
import type { WaitlistInput, WaitlistOutput } from "./schemas.ts";
import { TurnstileVerifier } from "./turnstile.ts";

export interface WaitlistServiceApi {
  readonly join: (
    input: WaitlistInput,
  ) => Effect.Effect<
    WaitlistOutput,
    | TurnstileNotConfigured
    | BotVerificationFailed
    | TurnstileRequestError
    | WaitlistPersistenceError
  >;
}

export class WaitlistService extends Context.Service<WaitlistService, WaitlistServiceApi>()(
  "cider/features/waitlist/WaitlistService",
) {}

export const WaitlistServiceLive = Layer.effect(
  WaitlistService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ids = yield* IdGenerator;
    const turnstile = yield* TurnstileVerifier;

    const join = Effect.fn("Waitlist.join")(function* (input: WaitlistInput) {
      yield* turnstile.verify(input.turnstile_token);
      const id = yield* ids.uuid;
      const email = input.email.toLowerCase().trim();
      const now = yield* Clock.currentTimeMillis;
      const createdAt = new Date(now).toISOString();
      yield* sql`
        INSERT OR IGNORE INTO waitlist_entry (id, email, created_at)
        VALUES (${id}, ${email}, ${createdAt})
      `.pipe(
            Effect.mapError((cause) => new WaitlistPersistenceError({ operation: "join", cause })),
          );
      return { ok: true } as const;
    });

    return WaitlistService.of({ join });
  }),
);
