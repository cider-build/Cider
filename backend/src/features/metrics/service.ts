import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import type {
  NodeId } from "../../domain/ids.ts";
import {
  OrganizationId,
  RequestId,
} from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { operationError } from "../../domain/errors.ts";
import type { MetricHistory, MetricReading, MetricWindow } from "./contracts.ts";

const MetricResourceKind = Schema.Literals(["sandbox", "server"]);
export type MetricResourceKind = typeof MetricResourceKind.Type;

const MetricQuery = Schema.Struct({
  organizationId: OrganizationId,
  resourceKind: MetricResourceKind,
  resourceId: Schema.String,
  cutoff: Schema.String,
});

const MetricRow = Schema.Struct({
  cpuPercent: Schema.Finite,
  memoryPercent: Schema.Finite,
  graphicsMemoryBytes: Schema.Int,
  collectedAt: Schema.DateTimeUtcFromString,
});

const ResourceLookup = Schema.Struct({
  organizationId: OrganizationId,
  resourceId: Schema.String,
});

const metricDuration = (window: MetricWindow) => {
  switch (window) {
    case "live":
      return { minutes: 10 } as const;
    case "1h":
      return { hours: 1 } as const;
    case "24h":
      return { hours: 24 } as const;
  }
};

export class MetricResourceNotFound extends Schema.TaggedError<MetricResourceNotFound>()(
  "Metrics.ResourceNotFound",
  { resourceKind: MetricResourceKind, resourceId: Schema.String },
) {}

export class MetricsPersistenceError extends Schema.TaggedError<MetricsPersistenceError>()(
  "Metrics.PersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const persistenceError = operationError(
  ({ operation, cause }) => new MetricsPersistenceError({ operation, cause }),
);

export interface MetricsServiceApi {
  readonly history: (
    organizationId: OrganizationId,
    resourceKind: MetricResourceKind,
    resourceId: string,
    window: MetricWindow,
  ) => Effect.Effect<MetricHistory, MetricResourceNotFound | MetricsPersistenceError>;
  readonly record: (input: {
    readonly organizationId: OrganizationId;
    readonly nodeId: NodeId;
    readonly resourceKind: MetricResourceKind;
    readonly resourceId: string;
    readonly reading: MetricReading;
  }) => Effect.Effect<void, MetricsPersistenceError>;
  readonly prune: Effect.Effect<void, MetricsPersistenceError>;
}

export class Metrics extends Context.Service<Metrics, MetricsServiceApi>()(
  "cider/features/metrics/Metrics",
) {
  static readonly layer = Layer.effect(
    Metrics,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ids = yield* IdGenerator;

      const sandboxExists = SqlSchema.findOneOption({
        Request: ResourceLookup,
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ organizationId, resourceId }) => sql`
          SELECT id FROM sandbox
          WHERE id = ${resourceId} AND organization_id = ${organizationId}
        `,
      });
      const serverExists = SqlSchema.findOneOption({
        Request: ResourceLookup,
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ organizationId, resourceId }) => sql`
          SELECT id FROM server
          WHERE id = ${resourceId} AND organization_id = ${organizationId}
        `,
      });
      const historyQuery = SqlSchema.findAll({
        Request: MetricQuery,
        Result: MetricRow,
        execute: ({ organizationId, resourceKind, resourceId, cutoff }) => sql`
          SELECT cpu_percent, memory_percent, graphics_memory_bytes, collected_at
          FROM resource_metric
          WHERE organization_id = ${organizationId}
            AND resource_kind = ${resourceKind}
            AND resource_id = ${resourceId}
            AND collected_at >= ${cutoff}
          ORDER BY collected_at
        `,
      });

      const history = Effect.fn("Metrics.history")(function* (
        organizationId: OrganizationId,
        resourceKind: MetricResourceKind,
        resourceId: string,
        window: MetricWindow,
      ) {
        const exists = yield* (resourceKind === "sandbox"
          ? sandboxExists({ organizationId, resourceId })
          : serverExists({ organizationId, resourceId })
        ).pipe(persistenceError("Metrics.history.resource"));
        if (Option.isNone(exists)) {
          return yield* new MetricResourceNotFound({ resourceKind, resourceId });
        }
        const now = yield* DateTime.now;
        const cutoff = DateTime.subtract(now, metricDuration(window));
        const samples = yield* historyQuery({
          organizationId,
          resourceKind,
          resourceId,
          cutoff: DateTime.formatIso(cutoff),
        }).pipe(persistenceError("Metrics.history.samples"));
        return {
          sampling_interval_seconds: 30 as const,
          samples: samples.map((sample) => ({
            cpu_percent: sample.cpuPercent,
            memory_percent: sample.memoryPercent,
            graphics_memory_bytes: sample.graphicsMemoryBytes,
            collected_at: sample.collectedAt,
          })),
        };
      });

      const record = Effect.fn("Metrics.record")(function* (
        input: Parameters<MetricsServiceApi["record"]>[0],
      ) {
        const id = RequestId.make(yield* ids.uuid);
        const now = yield* DateTime.now;
        yield* sql`
          INSERT INTO resource_metric (
            id, organization_id, node_id, resource_kind, resource_id,
            cpu_percent, memory_percent, graphics_memory_bytes, collected_at
          ) VALUES (
            ${id}, ${input.organizationId}, ${input.nodeId}, ${input.resourceKind},
            ${input.resourceId}, ${input.reading.cpu_percent},
            ${input.reading.memory_percent}, ${input.reading.graphics_memory_bytes},
            ${DateTime.formatIso(now)}
          )
        `.pipe(
                Effect.asVoid,
                persistenceError("Metrics.record"),
              );
      });

      const prune = Effect.fn("Metrics.prune")(function* () {
        const now = yield* DateTime.now;
        const cutoff = DateTime.subtract(now, { hours: 25 });
        yield* sql`
          DELETE FROM resource_metric WHERE collected_at < ${DateTime.formatIso(cutoff)}
        `.pipe(Effect.asVoid, persistenceError("Metrics.prune"));
      });

      return Metrics.of({ history, record, prune: prune() });
    }),
  );
}
