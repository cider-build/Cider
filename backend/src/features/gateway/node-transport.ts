import { Context, Effect, Layer, Schema } from "effect";

import type { NodeId } from "../../domain/ids.ts";
import {
  NodeRequestFailed,
  NodeResponseInvalid,
  type NodeUnavailableError,
} from "./errors.ts";
import { NodeGateway } from "./node-gateway.ts";
import type { GatewayMethod, GatewayResponse } from "./protocol.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface NodeRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly json?: Schema.Json;
}

export interface NodeResponse extends GatewayResponse {
  readonly nodeId: NodeId;
  readonly text: string;
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

/**
 * Decodes a node JSON body. A body that does not match the protocol schema is a
 * `NodeResponseInvalid` failure that keeps the schema issue as `cause`.
 */
export const decodeNodeJson = <A, I, R>(
  response: NodeResponse,
  schema: Schema.Codec<A, I, R>,
  operation: string,
): Effect.Effect<A, NodeResponseInvalid, R> =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(response.text).pipe(
    Effect.mapError(
      (cause) => new NodeResponseInvalid({ nodeId: response.nodeId, operation, cause }),
    ),
  );

export interface NodeTransportApi {
  readonly request: (
    nodeId: NodeId,
    method: GatewayMethod,
    path: string,
    options?: NodeRequestOptions,
  ) => Effect.Effect<NodeResponse, NodeUnavailableError | NodeRequestFailed>;
  readonly isConnected: (nodeId: NodeId) => Effect.Effect<boolean>;
}

export class NodeTransport extends Context.Service<NodeTransport, NodeTransportApi>()(
  "cider/features/gateway/NodeTransport",
) {}

export const NodeTransportLive = Layer.effect(
  NodeTransport,
  Effect.gen(function* () {
    const gateway = yield* NodeGateway;

    const request = Effect.fn("NodeTransport.request")(function* (
      nodeId: NodeId,
      method: GatewayMethod,
      rawPath: string,
      options?: NodeRequestOptions,
    ) {
      if (options?.body !== undefined && options.json !== undefined) {
        // A caller bug, not a runtime condition: surface it as a defect.
        return yield* Effect.die(new Error("node request cannot contain two bodies"));
      }
      const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
      const body
        = options?.json !== undefined
          ? encoder.encode(yield* encodeJson(options.json).pipe(Effect.orDie))
          : (options?.body ?? new Uint8Array());
      const baseHeaders = {
        "accept": "*/*",
        ...options?.headers,
        "content-length": String(body.length),
      } satisfies Readonly<Record<string, string>>;
      const headers
        = options?.json === undefined
          ? baseHeaders
          : { ...baseHeaders, "content-type": "application/json" };
      const response = yield* gateway.request(nodeId, method, path, headers, body);
      const text = decoder.decode(response.body);
      if (response.status >= 400) {
        return yield* new NodeRequestFailed({ nodeId, status: response.status, detail: text });
      }
      return { ...response, nodeId, text };
    });

    return NodeTransport.of({ request, isConnected: gateway.isConnected });
  }),
);
