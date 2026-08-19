import { Context, Deferred, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";
import { Socket } from "effect/unstable/socket";

import type { NodeId, VmId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { GatewayProtocolError, NodeUnavailableError } from "./errors.ts";
import {
  GatewayInboundControl,
  type GatewayMethod,
  GatewayOutboundControl,
  type GatewayResponse,
} from "./protocol.ts";

const CHUNK_SIZE = 256 * 1024;
const REQUEST_TIMEOUT = "30 minutes";
const SSH_TIMEOUT = "30 seconds";

type SocketWriter = (
  chunk: Uint8Array | string | Socket.CloseEvent,
) => Effect.Effect<void, Socket.SocketError>;

interface PendingRequest {
  readonly response: Deferred.Deferred<GatewayResponse, NodeUnavailableError>;
  readonly metadata: Ref.Ref<{
    readonly status: number | undefined;
    readonly headers: Readonly<Record<string, string>>;
  }>;
  readonly chunks: Ref.Ref<ReadonlyArray<Uint8Array>>;
}

export interface NodeConnection {
  readonly identity: object;
  readonly nodeId: NodeId;
  readonly write: SocketWriter;
  readonly sendLock: Semaphore.Semaphore;
  readonly pending: Ref.Ref<ReadonlyMap<string, PendingRequest>>;
}

export interface SshTunnel {
  readonly id: string;
  readonly nodeId: NodeId;
  readonly socket: Deferred.Deferred<SshAttached, NodeUnavailableError>;
  readonly done: Deferred.Deferred<void>;
}

interface SshAttached {
  readonly socket: Socket.Socket;
  readonly write: SocketWriter;
}

const connectionFailure = (detail: string) => new NodeUnavailableError({ detail });

const socketFailure = (detail: string) => Effect.mapError(() => connectionFailure(detail));

/**
 * Sends a close frame on a socket that a route currently runs. Socket writes
 * wait for `runRaw`; the timeout keeps a socket that stopped running from
 * blocking gateway bookkeeping or the layer finalizer.
 */
const closeSocket = (write: SocketWriter, code: number, reason: string): Effect.Effect<void> =>
  write(new Socket.CloseEvent(code, reason)).pipe(Effect.timeout("2 seconds"), Effect.ignore);

const encodeControl = (value: GatewayOutboundControl) =>
  Schema.encodeEffect(Schema.fromJsonString(GatewayOutboundControl))(value).pipe(
    Effect.mapError(() => connectionFailure("node connection failed")),
  );

const requestIdBytes = (requestId: string): Uint8Array =>
  Uint8Array.from(Buffer.from(requestId, "hex"));

const binaryRequestId = (frame: Uint8Array): string =>
  Buffer.from(frame.subarray(0, 16)).toString("hex");

const copyMapWithout = <K, V>(source: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const next = new Map(source);
  next.delete(key);
  return next;
};

const failPending = (connection: NodeConnection, error: NodeUnavailableError) =>
  Ref.get(connection.pending).pipe(
    Effect.flatMap((pending) =>
      Effect.forEach(pending.values(), ({ response }) => Deferred.fail(response, error), {
        discard: true,
      }),
    ),
  );

export interface NodeGatewayApi {
  readonly add: (nodeId: NodeId, write: SocketWriter) => Effect.Effect<NodeConnection>;
  readonly remove: (nodeId: NodeId, connection: NodeConnection) => Effect.Effect<void>;
  readonly isConnected: (nodeId: NodeId) => Effect.Effect<boolean>;
  readonly disconnect: (nodeId: NodeId) => Effect.Effect<void>;
  readonly request: (
    nodeId: NodeId,
    method: GatewayMethod,
    path: string,
    headers: Readonly<Record<string, string>>,
    body: Uint8Array,
  ) => Effect.Effect<GatewayResponse, NodeUnavailableError>;
  readonly handleFrame: (
    connection: NodeConnection,
    frame: string | Uint8Array,
  ) => Effect.Effect<void, GatewayProtocolError | NodeUnavailableError>;
  readonly beginSsh: (nodeId: NodeId, vmId: VmId) => Effect.Effect<SshTunnel, NodeUnavailableError>;
  readonly waitForSsh: (tunnel: SshTunnel) => Effect.Effect<Socket.Socket, NodeUnavailableError>;
  /**
   * Attaches a node socket to a tunnel and waits for the session to finish.
   * Returns `false` when the tunnel is unknown or already attached.
   */
  readonly attachSsh: (
    nodeId: NodeId,
    tunnelId: string,
    socket: Socket.Socket,
    write: SocketWriter,
  ) => Effect.Effect<boolean>;
  readonly finishSsh: (tunnel: SshTunnel) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export class NodeGateway extends Context.Service<NodeGateway, NodeGatewayApi>()(
  "cider/features/gateway/NodeGateway",
) {}

export const NodeGatewayLive = Layer.effect(
  NodeGateway,
  Effect.gen(function* () {
    const connections = yield* Ref.make<ReadonlyMap<NodeId, NodeConnection>>(new Map());
    const tunnels = yield* Ref.make<ReadonlyMap<string, SshTunnel>>(new Map());
    const ids = yield* IdGenerator;

    const failNodeTunnels = Effect.fn("NodeGateway.failNodeTunnels")(function* (
      nodeId: NodeId,
      error: NodeUnavailableError,
    ) {
      const current = yield* Ref.get(tunnels);
      yield* Effect.forEach(
        current.values(),
        (tunnel) =>
          tunnel.nodeId === nodeId
            ? Effect.all([
                Deferred.fail(tunnel.socket, error),
                Deferred.succeed(tunnel.done, undefined),
              ]).pipe(Effect.asVoid)
            : Effect.void,
        { discard: true },
      );
    });

    const add = Effect.fn("NodeGateway.add")(function* (nodeId: NodeId, write: SocketWriter) {
      const connection: NodeConnection = {
        identity: {},
        nodeId,
        write,
        sendLock: yield* Semaphore.make(1),
        pending: yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map()),
      };
      const existing = yield* Ref.modify(connections, (current) => {
        const next = new Map(current);
        const previous = next.get(nodeId);
        next.set(nodeId, connection);
        return [previous, next];
      });
      if (existing !== undefined) {
        yield* failPending(existing, connectionFailure("node connection was superseded"));
        yield* closeSocket(existing.write, 1008, "superseded by a new connection");
      }
      return connection;
    });

    const remove = Effect.fn("NodeGateway.remove")(function* (
      nodeId: NodeId,
      connection: NodeConnection,
    ) {
      yield* Ref.update(connections, (current) =>
        current.get(nodeId)?.identity === connection.identity
          ? copyMapWithout(current, nodeId)
          : current,
      );
      const error = connectionFailure("node disconnected");
      yield* failPending(connection, error);
      yield* failNodeTunnels(nodeId, error);
    });

    const isConnected = Effect.fn("NodeGateway.isConnected")((nodeId: NodeId) =>
      Ref.get(connections).pipe(Effect.map((current) => current.has(nodeId))),
    );

    const disconnect = Effect.fn("NodeGateway.disconnect")(function* (nodeId: NodeId) {
      const connection = yield* Ref.modify(connections, (current) => [
        current.get(nodeId),
        copyMapWithout(current, nodeId),
      ]);
      if (connection === undefined) {
        return;
      }
      const error = connectionFailure("node revoked");
      yield* failPending(connection, error);
      yield* failNodeTunnels(nodeId, error);
      yield* closeSocket(connection.write, 1008, "node revoked");
    });

    const writeControl = Effect.fn("NodeGateway.writeControl")(
      (connection: NodeConnection, control: GatewayOutboundControl) =>
        encodeControl(control).pipe(
          Effect.flatMap(connection.write),
          socketFailure("node connection failed"),
        ),
    );

    const writeBody = Effect.fn("NodeGateway.writeBody")(function* (
      connection: NodeConnection,
      requestId: string,
      body: Uint8Array,
    ) {
      const identifier = requestIdBytes(requestId);
      if (body.length === 0) {
        const frame = new Uint8Array(17);
        frame.set(identifier);
        frame[16] = 1;
        yield* connection.write(frame).pipe(socketFailure("node connection failed"));
        return;
      }
      for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
        const chunk = body.subarray(offset, Math.min(offset + CHUNK_SIZE, body.length));
        const frame = new Uint8Array(17 + chunk.length);
        frame.set(identifier);
        frame[16] = offset + chunk.length === body.length ? 1 : 0;
        frame.set(chunk, 17);
        yield* connection.write(frame).pipe(socketFailure("node connection failed"));
      }
    });

    const request = Effect.fn("NodeGateway.request")(function* (
      nodeId: NodeId,
      method: GatewayMethod,
      path: string,
      headers: Readonly<Record<string, string>>,
      body: Uint8Array,
    ) {
      const connection = yield* Ref.get(connections).pipe(
        Effect.map((current) => current.get(nodeId)),
      );
      if (connection === undefined) {
        return yield* connectionFailure("node is not connected");
      }
      const requestId = yield* ids.uuid;
      const pending: PendingRequest = {
        response: yield* Deferred.make<GatewayResponse, NodeUnavailableError>(),
        metadata: yield* Ref.make<{
          readonly status: number | undefined;
          readonly headers: Readonly<Record<string, string>>;
        }>({
          status: undefined,
          headers: {},
        }),
        chunks: yield* Ref.make<ReadonlyArray<Uint8Array>>([]),
      };
      yield* Ref.update(connection.pending, (current) => {
        const next = new Map(current);
        next.set(requestId, pending);
        return next;
      });

      const operation = Effect.gen(function* () {
        yield* connection.sendLock.withPermits(1)(
          Effect.gen(function* () {
            yield* writeControl(connection, {
              type: "request",
              id: requestId,
              method,
              path,
              headers,
              body_length: body.length,
            });
            yield* writeBody(connection, requestId, body);
          }),
        );
        const result = yield* Deferred.await(pending.response).pipe(
          Effect.timeoutOption(REQUEST_TIMEOUT),
        );
        return yield* Option.match(result, {
          onNone: () => Effect.fail(connectionFailure("node request timed out")),
          onSome: Effect.succeed,
        });
      });

      return yield* operation.pipe(
        Effect.ensuring(
          Ref.update(connection.pending, (current) => copyMapWithout(current, requestId)),
        ),
      );
    });

    const handleText = Effect.fn("NodeGateway.handleText")(function* (
      connection: NodeConnection,
      raw: string,
    ) {
      const message = yield* Schema.decodeEffect(
        Schema.fromJsonString(GatewayInboundControl),
      )(raw).pipe(
        Effect.mapError(() => new GatewayProtocolError({ detail: "invalid connector message" })),
      );
      if (message.type === "heartbeat") {
        yield* connection.sendLock.withPermits(1)(
          writeControl(connection, { type: "heartbeat_ack" }),
        );
        return;
      }
      if (message.type === "ssh_error") {
        const tunnel = yield* Ref.get(tunnels).pipe(
          Effect.map((current) => current.get(message.id)),
        );
        if (tunnel !== undefined) {
          yield* Deferred.fail(
            tunnel.socket,
            connectionFailure(
              message.detail === undefined || message.detail === null || message.detail === ""
                ? "node could not open SSH"
                : message.detail,
            ),
          );
        }
        return;
      }
      const pending = yield* Ref.get(connection.pending).pipe(
        Effect.map((current) => current.get(message.id)),
      );
      if (pending !== undefined) {
        yield* Ref.set(pending.metadata, {
          status: message.status,
          headers: message.headers ?? {},
        });
      }
    });

    const handleBytes = Effect.fn("NodeGateway.handleBytes")(function* (
      connection: NodeConnection,
      frame: Uint8Array,
    ) {
      if (frame.length < 17) {
        return yield* new GatewayProtocolError({ detail: "invalid connector message" });
      }
      const requestId = binaryRequestId(frame);
      const pending = yield* Ref.get(connection.pending).pipe(
        Effect.map((current) => current.get(requestId)),
      );
      if (pending === undefined) {
        return;
      }
      yield* Ref.update(pending.chunks, (chunks) => [...chunks, frame.slice(17)]);
      if (frame[16] !== 1) {
        return;
      }
      const metadata = yield* Ref.get(pending.metadata);
      if (metadata.status === undefined) {
        yield* Deferred.fail(pending.response, connectionFailure("node connection failed"));
        return;
      }
      const chunks = yield* Ref.get(pending.chunks);
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      yield* Deferred.succeed(pending.response, {
        status: metadata.status,
        headers: metadata.headers,
        body,
      });
    });

    const handleFrame = Effect.fn("NodeGateway.handleFrame")(
      (connection: NodeConnection, frame: string | Uint8Array) =>
        Schema.is(Schema.String)(frame)
          ? handleText(connection, frame)
          : handleBytes(connection, frame),
    );

    const beginSsh = Effect.fn("NodeGateway.beginSsh")(function* (nodeId: NodeId, vmId: VmId) {
      const connection = yield* Ref.get(connections).pipe(
        Effect.map((current) => current.get(nodeId)),
      );
      if (connection === undefined) {
        return yield* connectionFailure("node is not connected");
      }
      const tunnel: SshTunnel = {
        id: yield* ids.uuid,
        nodeId,
        socket: yield* Deferred.make<SshAttached, NodeUnavailableError>(),
        done: yield* Deferred.make<void>(),
      };
      yield* Ref.update(tunnels, (current) => {
        const next = new Map(current);
        next.set(tunnel.id, tunnel);
        return next;
      });
      const sent = connection.sendLock.withPermits(1)(
        writeControl(connection, {
          type: "ssh_open",
          id: tunnel.id,
          sandbox_id: vmId,
        }),
      );
      return yield* sent.pipe(
        Effect.as(tunnel),
        Effect.tapError(() => Ref.update(tunnels, (current) => copyMapWithout(current, tunnel.id))),
      );
    });

    const waitForSsh = Effect.fn("NodeGateway.waitForSsh")((tunnel: SshTunnel) =>
      Deferred.await(tunnel.socket).pipe(
        Effect.timeoutOption(SSH_TIMEOUT),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(connectionFailure("node SSH tunnel timed out")),
            onSome: (attached) => Effect.succeed(attached.socket),
          }),
        ),
      ),
    );

    const attachSsh = Effect.fn("NodeGateway.attachSsh")(function* (
      nodeId: NodeId,
      tunnelId: string,
      socket: Socket.Socket,
      write: SocketWriter,
    ) {
      const tunnel = yield* Ref.get(tunnels).pipe(Effect.map((current) => current.get(tunnelId)));
      if (tunnel === undefined || tunnel.nodeId !== nodeId) {
        return false;
      }
      const attached = yield* Deferred.succeed(tunnel.socket, { socket, write });
      if (!attached) {
        return false;
      }
      yield* Deferred.await(tunnel.done);
      return true;
    });

    /**
     * Forgets a tunnel and releases the node side. The attached node socket
     * closes when its own `runRaw` scope ends, so no close frame is sent here.
     */
    const finishSsh = Effect.fn("NodeGateway.finishSsh")(function* (tunnel: SshTunnel) {
      yield* Ref.update(tunnels, (current) =>
        current.get(tunnel.id) === tunnel ? copyMapWithout(current, tunnel.id) : current,
      );
      yield* Deferred.succeed(tunnel.done, undefined);
    });

    const close = Effect.gen(function* () {
      const activeConnections = yield* Ref.getAndSet(connections, new Map());
      yield* Effect.forEach(
        activeConnections.values(),
        (connection) =>
          Effect.gen(function* () {
            yield* failPending(connection, connectionFailure("service restarting"));
            yield* closeSocket(connection.write, 1012, "service restarting");
          }),
        { discard: true },
      );
      const activeTunnels = yield* Ref.getAndSet(tunnels, new Map());
      yield* Effect.forEach(
        activeTunnels.values(),
        (tunnel) =>
          Effect.all([
            Deferred.fail(tunnel.socket, connectionFailure("service restarting")),
            Deferred.succeed(tunnel.done, undefined),
          ]).pipe(Effect.asVoid),
        { discard: true },
      );
    }).pipe(Effect.withSpan("NodeGateway.close"));

    yield* Effect.addFinalizer(() => close);

    return NodeGateway.of({
      add,
      remove,
      isConnected,
      disconnect,
      request,
      handleFrame,
      beginSsh,
      waitForSsh,
      attachSsh,
      finishSsh,
      close,
    });
  }),
);
