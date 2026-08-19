import { NodeHttpClient } from "@effect/platform-node";
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { BotVerificationFailed, TurnstileNotConfigured, TurnstileRequestError } from "./errors.ts";

const TurnstileResponse = Schema.Struct({
  success: Schema.optionalKey(Schema.Boolean),
});

export interface TurnstileVerifierApi {
  readonly verify: (
    token: string,
  ) => Effect.Effect<void, TurnstileNotConfigured | BotVerificationFailed | TurnstileRequestError>;
}

export class TurnstileVerifier extends Context.Service<TurnstileVerifier, TurnstileVerifierApi>()(
  "cider/features/waitlist/TurnstileVerifier",
) {}

const layer = Layer.effect(
  TurnstileVerifier,
  Effect.gen(function* () {
    const secret = yield* Config.option(Config.redacted("CIDER_TURNSTILE_SECRET_KEY"));
    const client = yield* HttpClient.HttpClient;

    const verify = Effect.fn("Turnstile.verify")(function* (token: string) {
      if (Option.isNone(secret) || Redacted.value(secret.value).length === 0) {
        return yield* new TurnstileNotConfigured();
      }
      const request = HttpClientRequest.post(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      ).pipe(
        HttpClientRequest.bodyUrlParams({
          secret: Redacted.value(secret.value),
          response: token,
        }),
      );
      const response = yield* client
        .execute(request)
        .pipe(Effect.mapError((cause) => new TurnstileRequestError({ cause })));
      const result = yield* HttpClientResponse.schemaBodyJson(TurnstileResponse)(response).pipe(
        Effect.mapError((cause) => new TurnstileRequestError({ cause })),
      );
      if (result.success !== true) {
        return yield* new BotVerificationFailed();
      }
    });

    return TurnstileVerifier.of({ verify });
  }),
);

export const TurnstileVerifierLive = layer.pipe(Layer.provide(NodeHttpClient.layerUndici));
