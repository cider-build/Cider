import { Schema } from "effect";

export class TurnstileNotConfigured extends Schema.TaggedError<TurnstileNotConfigured>()(
  "Waitlist.TurnstileNotConfigured",
  {},
) {}

export class BotVerificationFailed extends Schema.TaggedError<BotVerificationFailed>()(
  "Waitlist.BotVerificationFailed",
  {},
) {}

export class TurnstileRequestError extends Schema.TaggedError<TurnstileRequestError>()(
  "Waitlist.TurnstileRequestError",
  { cause: Schema.Defect() },
) {}

export class WaitlistPersistenceError extends Schema.TaggedError<WaitlistPersistenceError>()(
  "Waitlist.WaitlistPersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}
