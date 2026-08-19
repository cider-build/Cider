import { Effect, Layer } from "effect";
import {
  HttpEffect,
  HttpRouter,
} from "effect/unstable/http";

import { Authentication } from "../auth.ts";

export const AuthenticationRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;

    yield* router.add(
      "*",
      "/api/auth/*",
      Authentication.use(({ handler }) =>
        HttpEffect.fromWebHandler(handler),
      ),
    );
  }),
);
