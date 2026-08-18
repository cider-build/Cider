import { Config, Data, Deferred, Effect, Layer, Option, Queue, Schema } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";

import { RequestAuthorization } from "../../auth/access.ts";
import type { RepositoryError } from "../../domain/errors.ts";
import { UnauthorizedError } from "../../domain/errors.ts";
import { NodeId, type OrganizationId } from "../../domain/ids.ts";
import { NodeMetadataInput } from "../nodes/schemas.ts";
import { NodeService } from "../nodes/service.ts";
import { WarmPool } from "../workers/warm-pool.ts";
import { GatewayProtocolError } from "./errors.ts";
import { type NodeConnection, NodeGateway } from "./node-gateway.ts";
import { SshTargets, type TerminalTarget, TerminalResourceKind } from "./ssh-targets.ts";

const LIVENESS_TIMEOUT = "60 seconds";

type IncomingFrame = string | Uint8Array;

type NextFrame = Data.TaggedEnum<{
  Frame: { readonly frame: IncomingFrame };
  Disconnected: { readonly closed: true };
}>;
const NextFrame = Data.taggedEnum<NextFrame>();

/**
 * A WebSocket route rejects a client by upgrading and closing with a code.
 * Route steps that run before the upgrade fail with this error; the route
 * boundary turns it into the close handshake.
 */
class CloseSocket extends Schema.TaggedError<CloseSocket>()("GatewayRoutes.CloseSocket", {
  code: Schema.Int,
  reason: Schema.String,
}) {}

const closeSocket = (code: number, reason: string) => () => new CloseSocket({ code, reason });

const NodePath = Schema.Struct({ nodeId: Schema.String });
const NodeSshPath = Schema.Struct({ nodeId: Schema.String, tunnelId: Schema.String });
const UserSshPath = Schema.Struct({ sandboxId: Schema.String });
const TerminalPath = Schema.Struct({
  kind: TerminalResourceKind,
  resourceId: Schema.String,
});

const NodeMetadataHeader = Schema.StringFromBase64.pipe(
  Schema.decodeTo(Schema.fromJsonString(NodeMetadataInput)),
);

const decodeNodeMetadata = (encoded: string) =>
  Schema.decodeEffect(NodeMetadataHeader)(encoded).pipe(
    Effect.mapError(() => new GatewayProtocolError({ detail: "invalid node metadata" })),
  );

const headersRecord = (headers: Headers.Headers): Readonly<Record<string, string | undefined>> =>
  headers;

const authorizationHeader = (request: HttpServerRequest.HttpServerRequest) =>
  Option.getOrUndefined(Headers.get(request.headers, "authorization"));

const CLOSE_TIMEOUT = "5 seconds";

/**
 * Closes a socket that nothing else runs. Socket writes wait for `runRaw` to
 * open the socket, so this runs it only to send the close frame.
 */
const closeWithoutServing = (socket: Socket.Socket, code: number, reason: string) =>
  Effect.gen(function* () {
    const write = yield* socket.writer;
    yield* socket
      .runRaw(() => Effect.void, {
        onOpen: write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore),
      })
      .pipe(Effect.timeout(CLOSE_TIMEOUT), Effect.ignore);
  });

/** Upgrades the socket only to send a close frame. Use before any other upgrade. */
const rejectUpgrade = (request: HttpServerRequest.HttpServerRequest, close: CloseSocket) =>
  Effect.gen(function* () {
    const socket = yield* request.upgrade;
    yield* closeWithoutServing(socket, close.code, close.reason);
    return HttpServerResponse.empty();
  });

type SocketWriter = (
  chunk: Uint8Array | string | Socket.CloseEvent,
) => Effect.Effect<void, Socket.SocketError>;

/** Sends a close frame on a socket that `runRaw` currently drives. */
const closeUpgraded = (write: SocketWriter, code: number, reason?: string) =>
  write(new Socket.CloseEvent(code, reason)).pipe(Effect.timeout(CLOSE_TIMEOUT), Effect.ignore);

const decodeNodeId = (raw: string) =>
  Schema.decodeEffect(NodeId)(raw).pipe(
    Effect.mapError(closeSocket(1008, "invalid node credential")),
  );

const hasValidCapacity = (metadata: NodeMetadataInput) =>
  metadata.storage_available_bytes <= metadata.storage_total_bytes
  && metadata.default_sandbox_cpu_count <= metadata.cpu_count
  && metadata.default_sandbox_memory_bytes <= metadata.memory_bytes
  && metadata.default_sandbox_storage_bytes <= metadata.storage_total_bytes;

/** Pumps frames from a node socket into the gateway until the node leaves or misbehaves. */
const runNodeSocket = (
  socket: Socket.Socket,
  connection: NodeConnection,
  gateway: NodeGateway["Service"],
) =>
  Effect.gen(function* () {
    const write = yield* socket.writer;
    const frames = yield* Queue.make<IncomingFrame>();
    const disconnected = yield* Deferred.make<void>();
    yield* socket
      .runRaw((frame) => Queue.offer(frames, frame))
      .pipe(
        Effect.ignore,
        Effect.ensuring(Deferred.succeed(disconnected, undefined)),
        Effect.forkScoped,
      );

    const handleFrame = (frame: IncomingFrame) =>
      gateway.handleFrame(connection, frame).pipe(
        Effect.as(true),
        Effect.catchTags({
          GatewayProtocolError: () =>
            closeUpgraded(write, 1003, "invalid connector message").pipe(Effect.as(false)),
          NodeUnavailableError: (error) =>
            closeUpgraded(write, 1011, error.detail).pipe(Effect.as(false)),
        }),
      );

    let connected = true;
    while (connected) {
      const next = yield* Effect.raceFirst(
        Queue.take(frames).pipe(Effect.map((frame) => NextFrame.Frame({ frame }))),
        Deferred.await(disconnected).pipe(Effect.as(NextFrame.Disconnected({ closed: true }))),
      ).pipe(Effect.timeoutOption(LIVENESS_TIMEOUT));
      connected = yield* Option.match(next, {
        onNone: () => closeUpgraded(write, 1011, "node liveness timeout").pipe(Effect.as(false)),
        onSome: NextFrame.$match({
          Disconnected: () => Effect.succeed(false),
          Frame: ({ frame }) => handleFrame(frame),
        }),
      });
    }
  });

const pipeSsh = (userSocket: Socket.Socket, nodeSocket: Socket.Socket) =>
  Effect.gen(function* () {
    const userWrite = yield* userSocket.writer;
    const nodeWrite = yield* nodeSocket.writer;
    yield* Effect.raceFirst(
      userSocket.runRaw((frame) => nodeWrite(frame)),
      nodeSocket.runRaw((frame) => userWrite(frame)),
    ).pipe(Effect.ignore);
  });

export const GatewayRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const allowedOrigin = yield* Config.url("CIDER_ALLOWED_ORIGIN");

    /** Serves an admitted node connection: upgrade, register, prime the warm pool, pump frames. */
    const serveNode = (request: HttpServerRequest.HttpServerRequest, nodeId: NodeId) =>
      Effect.gen(function* () {
        const gateway = yield* NodeGateway;
        const warmPool = yield* WarmPool;
        const socket = yield* request.upgrade;
        const write = yield* socket.writer;
        const connection = yield* gateway.add(nodeId, write);
        yield* warmPool.ensureNode(nodeId).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                yield* Effect.logError("GatewayRoutes.warm_pool_failed", error).pipe(
                  Effect.annotateLogs({ nodeId }),
                );
                yield* gateway.remove(nodeId, connection);
                yield* closeWithoutServing(socket, 1011, "warm pool setup failed");
              }),
            onSuccess: () =>
              runNodeSocket(socket, connection, gateway).pipe(
                Effect.ensuring(gateway.remove(nodeId, connection)),
              ),
          }),
        );
        return HttpServerResponse.empty();
      });

    const nodeConnection = Effect.fn("GatewayRoutes.nodeConnection")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = yield* HttpRouter.schemaPathParams(NodePath);
      const nodes = yield* NodeService;
      const admission = Effect.gen(function* () {
        const encodedMetadata = Option.getOrElse(
          Headers.get(request.headers, "x-cider-node-metadata"),
          () => "",
        );
        const metadata = yield* decodeNodeMetadata(encodedMetadata).pipe(
          Effect.mapError(closeSocket(1008, "invalid node metadata")),
        );
        if (!hasValidCapacity(metadata)) {
          return yield* new CloseSocket({ code: 1008, reason: "invalid node capacity metadata" });
        }
        const nodeId = yield* decodeNodeId(path.nodeId);
        yield* nodes.connect(nodeId, authorizationHeader(request), metadata).pipe(
          Effect.catchTags({
            "Nodes.NodeConnectionRejected": closeSocket(1008, "invalid node credential"),
            "Nodes.NodePersistenceError": (error) =>
              Effect.logError("GatewayRoutes.node_connect_failed", error).pipe(
                Effect.andThen(new CloseSocket({ code: 1011, reason: "node connection failed" })),
              ),
          }),
        );
        return nodeId;
      });
      return yield* admission.pipe(
        Effect.matchEffect({
          onFailure: (close) => rejectUpgrade(request, close),
          onSuccess: (nodeId) => serveNode(request, nodeId),
        }),
      );
    });

    /**
     * Bridges a user socket to a node SSH tunnel. Both sockets close when
     * `pipeSsh` returns, because their `runRaw` scopes release them.
     */
    const proxyUserSsh = (request: HttpServerRequest.HttpServerRequest, target: TerminalTarget) =>
      Effect.gen(function* () {
        const gateway = yield* NodeGateway;
        const userSocket = yield* request.upgrade;
        yield* gateway.beginSsh(target.nodeId, target.vmId).pipe(
          Effect.matchEffect({
            onFailure: (error) => closeWithoutServing(userSocket, 1011, error.detail),
            onSuccess: (tunnel) =>
              gateway.waitForSsh(tunnel).pipe(
                Effect.matchEffect({
                  onFailure: (error) => closeWithoutServing(userSocket, 1011, error.detail),
                  onSuccess: (nodeSocket) => pipeSsh(userSocket, nodeSocket),
                }),
                Effect.ensuring(gateway.finishSsh(tunnel)),
              ),
          }),
        );
        return HttpServerResponse.empty();
      });

    /** Authenticates a browser WebSocket: same origin and a valid session. */
    const authorizeUserSocket = Effect.fn("GatewayRoutes.authorizeUserSocket")(function* (
      request: HttpServerRequest.HttpServerRequest,
    ) {
      const origin = Option.getOrUndefined(Headers.get(request.headers, "origin"));
      if (origin !== undefined && origin !== allowedOrigin.origin) {
        return yield* new UnauthorizedError({ detail: "origin not allowed" });
      }
      const authorization = yield* RequestAuthorization;
      return yield* authorization.current(headersRecord(request.headers));
    });

    const admitUser = (request: HttpServerRequest.HttpServerRequest) =>
      authorizeUserSocket(request).pipe(
        Effect.catchTags({
          UnauthorizedError: (error) => new CloseSocket({ code: 1008, reason: error.detail }),
          RepositoryError: (error) =>
            Effect.logError("GatewayRoutes.authorize_failed", error).pipe(
              Effect.andThen(new CloseSocket({ code: 1008, reason: "authorization failed" })),
            ),
        }),
      );

    /** Resolves a user's requested VM or fails with the close reason to send. */
    const requireTarget = (
      lookup: Effect.Effect<Option.Option<TerminalTarget>, RepositoryError>,
      missing: string,
    ) =>
      lookup.pipe(
        Effect.catch((error) =>
          Effect.logError("GatewayRoutes.target_lookup_failed", error).pipe(
            Effect.as(Option.none<TerminalTarget>()),
          ),
        ),
        Effect.flatMap(
          Option.match({
            onNone: () => new CloseSocket({ code: 1008, reason: missing }),
            onSome: Effect.succeed,
          }),
        ),
      );

    /** Runs a user WebSocket route: admit, resolve the target, then proxy SSH. */
    const userSocketRoute = <A>(
      pathSchema: Schema.Codec<A, Readonly<Record<string, string | undefined>>>,
      resolve: (
        path: A,
        organizationId: OrganizationId,
      ) => Effect.Effect<TerminalTarget, CloseSocket, SshTargets>,
    ) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = yield* HttpRouter.schemaPathParams(pathSchema);
        return yield* admitUser(request).pipe(
          Effect.flatMap((principal) => resolve(path, principal.organizationId)),
          Effect.matchEffect({
            onFailure: (close) => rejectUpgrade(request, close),
            onSuccess: (target) => proxyUserSsh(request, target),
          }),
        );
      });

    const terminalRoute = userSocketRoute(TerminalPath, (path, organizationId) =>
      SshTargets.use((targets) =>
        requireTarget(
          targets.terminalTarget(organizationId, path.kind, path.resourceId),
          "running resource not found",
        ),
      ),
    );

    const userSshRoute = userSocketRoute(UserSshPath, (path, organizationId) =>
      SshTargets.use((targets) =>
        requireTarget(
          targets.sshVmTarget(organizationId, path.sandboxId),
          "available sandbox not found",
        ),
      ),
    );

    const nodeSshRoute = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = yield* HttpRouter.schemaPathParams(NodeSshPath);
      const authorization = yield* RequestAuthorization;
      const gateway = yield* NodeGateway;
      const admission = decodeNodeId(path.nodeId).pipe(
        Effect.tap((nodeId) =>
          authorization
            .node(headersRecord(request.headers), nodeId)
            .pipe(Effect.mapError(closeSocket(1008, "invalid node credential"))),
        ),
      );
      return yield* admission.pipe(
        Effect.matchEffect({
          onFailure: (close) => rejectUpgrade(request, close),
          onSuccess: (nodeId) =>
            Effect.gen(function* () {
              const socket = yield* request.upgrade;
              const write = yield* socket.writer;
              const attached = yield* gateway.attachSsh(nodeId, path.tunnelId, socket, write);
              if (!attached) {
                yield* closeWithoutServing(socket, 1008, "invalid SSH tunnel");
              }
              return HttpServerResponse.empty();
            }),
        }),
      );
    });

    yield* router.add("GET", "/node-connections/:nodeId", nodeConnection());
    yield* router.add("GET", "/terminal/:kind/:resourceId", terminalRoute);
    yield* router.add("GET", "/ssh/:sandboxId", userSshRoute);
    yield* router.add("GET", "/node-ssh/:nodeId/:tunnelId", nodeSshRoute);
  }),
);
