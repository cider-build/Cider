import { Schema } from "effect";

export const WaitlistInput = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  turnstile_token: Schema.String,
});

export type WaitlistInput = Schema.Schema.Type<typeof WaitlistInput>;

export const WaitlistOutput = Schema.Struct({ ok: Schema.Literal(true) });

export type WaitlistOutput = Schema.Schema.Type<typeof WaitlistOutput>;
