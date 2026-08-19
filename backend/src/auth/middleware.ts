import { Effect, Layer, Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import { Unauthorized } from "../http/errors.ts";
import {
  Authorization,
  CurrentNode,
  CurrentPrincipal,
  NodeAuthorization,
} from "../http/middleware.ts";
import { RequestAuthorization } from "./access.ts";

const notAuthenticated = () => new Unauthorized({ detail: "not authenticated" });

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const authorization = yield* RequestAuthorization;

    const withPrincipal = Effect.fn("Authorization.withPrincipal")(function* <A, E, R>(
      httpEffect: Effect.Effect<A, E, R>,
    ) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const principal = yield* authorization.current(request.headers).pipe(
        Effect.catchTags({
          UnauthorizedError: (error) => new Unauthorized({ detail: error.detail }),
          RepositoryError: Effect.die,
        }),
      );
      return yield* Effect.provideService(httpEffect, CurrentPrincipal, principal);
    });

    return Authorization.of({
      bearer: (httpEffect, { credential }) =>
        Redacted.value(credential) === "" ? notAuthenticated() : withPrincipal(httpEffect),
      session: (httpEffect) => withPrincipal(httpEffect),
    });
  }),
);

export const NodeAuthorizationLive = Layer.effect(
  NodeAuthorization,
  Effect.gen(function* () {
    const authorization = yield* RequestAuthorization;

    return NodeAuthorization.of({
      bearer: Effect.fn("NodeAuthorization.bearer")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const node = yield* authorization.storageNode(request.headers).pipe(
          Effect.catchTags({
            UnauthorizedError: () => new Unauthorized({ detail: "invalid node credential" }),
            RepositoryError: Effect.die,
          }),
        );
        return yield* Effect.provideService(httpEffect, CurrentNode, node);
      }),
    });
  }),
);
