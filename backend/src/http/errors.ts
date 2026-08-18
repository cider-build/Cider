import { ErrorReporter, Schema } from "effect";

const detail = { detail: Schema.String };

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", detail, {
  httpApiStatus: 400,
}) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", detail, {
  httpApiStatus: 401,
}) {
  override readonly [ErrorReporter.ignore] = true;
}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", detail, {
  httpApiStatus: 404,
}) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", detail, {
  httpApiStatus: 409,
}) {
  override readonly [ErrorReporter.ignore] = true;
}

export class UnprocessableContent extends Schema.TaggedError<UnprocessableContent>()(
  "UnprocessableContent",
  detail,
  { httpApiStatus: 422 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  "TooManyRequests",
  detail,
  { httpApiStatus: 429 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  "ServiceUnavailable",
  detail,
  { httpApiStatus: 503 },
) {
  override readonly [ErrorReporter.ignore] = true;
}
