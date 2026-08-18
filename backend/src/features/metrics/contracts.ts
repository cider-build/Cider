import { Schema } from "effect";

export const MetricWindow = Schema.Literals(["live", "1h", "24h"]);
export type MetricWindow = typeof MetricWindow.Type;

export const MetricSample = Schema.Struct({
  cpu_percent: Schema.Finite,
  memory_percent: Schema.Finite,
  graphics_memory_bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  collected_at: Schema.DateTimeUtc,
});
export type MetricSample = Schema.Schema.Type<typeof MetricSample>;

export const MetricHistory = Schema.Struct({
  sampling_interval_seconds: Schema.Literal(30),
  samples: Schema.Array(MetricSample),
});
export type MetricHistory = Schema.Schema.Type<typeof MetricHistory>;

export const MetricReading = Schema.Struct({
  cpu_percent: Schema.Finite,
  memory_percent: Schema.Finite,
  graphics_memory_bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type MetricReading = Schema.Schema.Type<typeof MetricReading>;
