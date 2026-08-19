import { randomBytes, randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";

export interface IdGeneratorApi {
  readonly uuid: Effect.Effect<string>;
  readonly token: Effect.Effect<string>;
}

export class IdGenerator extends Context.Service<IdGenerator, IdGeneratorApi>()(
  "cider/IdGenerator",
) {
  static readonly layer = Layer.succeed(
    IdGenerator,
    IdGenerator.of({
      uuid: Effect.sync(() => randomUUID().replaceAll("-", "")),
      token: Effect.sync(() => randomBytes(32).toString("hex")),
    }),
  );
}
