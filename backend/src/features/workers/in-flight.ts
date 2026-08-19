import { Context, Effect, FiberMap, Layer } from "effect";

export interface InFlightApi {
  readonly run: (key: string, task: Effect.Effect<void>) => Effect.Effect<void>;
  readonly isActive: (key: string) => Effect.Effect<boolean>;
}

export class InFlight extends Context.Service<InFlight, InFlightApi>()(
  "cider/features/workers/InFlight",
) {}

export const InFlightLive = Layer.effect(
  InFlight,
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string, void, never>();

    const run = Effect.fn("InFlight.run")((key: string, task: Effect.Effect<void>) =>
      FiberMap.run(fibers, key, { onlyIfMissing: true })(task).pipe(Effect.asVoid),
    );

    const isActive = Effect.fn("InFlight.isActive")((key: string) => FiberMap.has(fibers, key));

    return InFlight.of({ run, isActive });
  }),
);
