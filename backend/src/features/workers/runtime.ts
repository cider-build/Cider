import { Effect, Layer, Schedule } from "effect";

import type { WorkerError } from "../gateway/errors.ts";
import { Maintenance } from "./maintenance.ts";

const supervisedPass = (
  name: string,
  pass: Effect.Effect<void, WorkerError>,
) =>
  pass.pipe(
    Effect.tapError((error) =>
      Effect.logError(`${name}.pass_failed`, error),
    ),
    Effect.ignore,
  );

export const WorkersLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const maintenance = yield* Maintenance;
    yield* supervisedPass("CleanupWorker", maintenance.cleanupExpired).pipe(
      Effect.repeat(Schedule.spaced("5 seconds")),
      Effect.forkScoped,
    );
    yield* supervisedPass("ReconcileWorker", maintenance.reconcileAll).pipe(
      Effect.repeat(Schedule.spaced("10 seconds")),
      Effect.forkScoped,
    );
    yield* supervisedPass("MetricsWorker", maintenance.collectMetrics).pipe(
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped,
    );
  }),
);
