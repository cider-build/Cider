import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { Authentication } from "../auth.ts";
import { RepositoryError, repositoryError, UnauthorizedError } from "../domain/errors.ts";
import { NodeId, OrganizationId, UserId } from "../domain/ids.ts";
import type { NodePrincipal, Principal } from "../http/middleware.ts";
import { hashToken, parseBearerToken } from "./tokens.ts";

type RequestHeaders = Readonly<Record<string, string | undefined>>;

const NodeTokenLookup = Schema.Struct({ tokenHash: Schema.String });

const NodeOrganization = Schema.Struct({
  nodeId: NodeId,
  organizationId: OrganizationId,
});

const unauthorized = (detail: string) => Effect.fail(new UnauthorizedError({ detail }));

const bearerToken = (headers: RequestHeaders): Effect.Effect<string, UnauthorizedError> =>
  headers.authorization === undefined
    ? unauthorized("not authenticated")
    : Option.match(parseBearerToken(headers.authorization), {
        onNone: () => unauthorized("invalid authorization header"),
        onSome: Effect.succeed,
      });

export interface RequestAuthorizationApi {
  readonly current: (
    headers: RequestHeaders,
  ) => Effect.Effect<Principal, UnauthorizedError | RepositoryError>;
  readonly node: (
    headers: RequestHeaders,
    nodeId: NodeId,
  ) => Effect.Effect<void, UnauthorizedError | RepositoryError>;
  readonly storageNode: (
    headers: RequestHeaders,
  ) => Effect.Effect<NodePrincipal, UnauthorizedError | RepositoryError>;
}

export class RequestAuthorization extends Context.Service<
  RequestAuthorization,
  RequestAuthorizationApi
>()("cider/RequestAuthorization") {
  static readonly layer = Layer.effect(
    RequestAuthorization,
    Effect.gen(function* () {
      const authentication = yield* Authentication;
      const sql = yield* SqlClient.SqlClient;

      const nodeTokenOwner = SqlSchema.findOneOption({
        Request: NodeTokenLookup,
        Result: NodeOrganization,
        execute: ({ tokenHash: hash }) => sql`
          SELECT node.id AS node_id, node.organization_id AS organization_id
          FROM node_credential
          JOIN node ON node.id = node_credential.node_id
          WHERE node_credential.token_hash = ${hash}
          LIMIT 1
        `,
      });

      const authorizeSession = Effect.fn("RequestAuthorization.authorizeSession")(
        function* (headers: RequestHeaders) {
          const session = yield* authentication.session(headers).pipe(
            Effect.mapError((cause) =>
              new RepositoryError({ operation: "authorizeSession", cause }),
            ),
          );
          if (session === null || session.activeOrganizationId === undefined) {
            return yield* unauthorized("not authenticated");
          }
          const identity = yield* Effect.all({
            userId: Schema.decodeEffect(UserId)(session.userId),
            organizationId: Schema.decodeEffect(OrganizationId)(session.activeOrganizationId),
          }).pipe(
            Effect.mapError(() => new UnauthorizedError({ detail: "invalid account" })),
          );
          return identity;
        },
      );

      const current = Effect.fn("RequestAuthorization.current")(authorizeSession);

      const storageNode = Effect.fn("RequestAuthorization.storageNode")(
        (headers: RequestHeaders) =>
          Effect.gen(function* () {
            const token = yield* bearerToken(headers);
            const owner = yield* nodeTokenOwner({ tokenHash: hashToken(token) }).pipe(
              repositoryError("authorizeNodeToken"),
            );
            return yield* Option.match(owner, {
              onNone: () => unauthorized("not authenticated"),
              onSome: Effect.succeed,
            });
          }),
      );

      const node = Effect.fn("RequestAuthorization.node")(
        (headers: RequestHeaders, nodeId: NodeId) =>
          storageNode(headers).pipe(
            Effect.flatMap((context) =>
              context.nodeId === nodeId
                ? Effect.void
                : unauthorized("not authenticated"),
            ),
          ),
      );

      return RequestAuthorization.of({ current, node, storageNode });
    }),
  );
}
