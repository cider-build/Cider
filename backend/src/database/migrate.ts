import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { AuthenticationLive } from "../auth.ts";
import { DatabaseLive } from "./live.ts";

Layer.build(DatabaseLive.pipe(Layer.provide(AuthenticationLive))).pipe(
  Effect.scoped,
  Effect.asVoid,
  NodeRuntime.runMain,
);
