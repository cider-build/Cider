import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Config, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiScalar } from "effect/unstable/httpapi";

import { AuthenticationLive } from "../auth.ts";
import { AuthorizationLive, NodeAuthorizationLive } from "../auth/middleware.ts";
import { AuthenticationRoutes } from "../auth/routes.ts";
import { GatewayRoutes, SshHandlers } from "../features/gateway/index.ts";
import { FeatureServicesLive } from "../features/live.ts";
import {
  SandboxesHandlers,
  ServersHandlers,
  SnapshotsHandlers,
} from "../features/machines/index.ts";
import { MetricsHandlers } from "../features/metrics/index.ts";
import { NodeStorageHandlers } from "../features/node-storage/index.ts";
import { NodesHandlers } from "../features/nodes/index.ts";
import { WaitlistHandlers } from "../features/waitlist/index.ts";
import { CiderApi } from "./api.ts";
import { UnprocessableContent } from "./errors.ts";
import { RequestValidation } from "./middleware.ts";
import { SystemHandlers } from "./system-handlers.ts";

const RequestValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(
  RequestValidation,
  (error) =>
    error.kind === "Body" || error.kind === "ResponseHeaders"
      ? Effect.die(error.cause)
      : new UnprocessableContent({
          detail: `invalid ${error.kind.toLowerCase()}: ${error.cause.message}`,
        }),
);

const MiddlewareLive = Layer.mergeAll(
  AuthorizationLive,
  NodeAuthorizationLive,
  RequestValidationLive,
);

const HandlersLive = Layer.mergeAll(
  SystemHandlers,
  NodesHandlers,
  SandboxesHandlers,
  ServersHandlers,
  SnapshotsHandlers,
  MetricsHandlers,
  SshHandlers,
  NodeStorageHandlers,
  WaitlistHandlers,
).pipe(Layer.provide(MiddlewareLive));

const ApiRoutes = HttpApiBuilder.layer(CiderApi, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(HandlersLive));

const Documentation = HttpApiScalar.layer(CiderApi, { path: "/docs" });

export const BaseRoutes = Layer.mergeAll(
  ApiRoutes,
  Documentation,
  AuthenticationRoutes,
  GatewayRoutes,
).pipe(
  HttpRouter.provideRequest(FeatureServicesLive),
  Layer.provide(FeatureServicesLive),
);

const CorsLive = Layer.unwrap(
  Config.url("CIDER_ALLOWED_ORIGIN").pipe(
    Effect.map((allowedOrigin) =>
      HttpRouter.cors({
        allowedOrigins: [allowedOrigin.origin],
        allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type"],
        credentials: true,
      }),
    ),
  ),
);

export const Routes = CorsLive.pipe(Layer.provideMerge(BaseRoutes));

const HttpServerLive = NodeHttpServer.layerConfig(createServer, {
  port: Config.port("CIDER_PORT"),
});

export const ApplicationLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(HttpServerLive),
  Layer.provide(AuthenticationLive),
);
