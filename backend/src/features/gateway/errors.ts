import { Schema } from "effect";

import { NodeId } from "../../domain/ids.ts";

/** The node has no live gateway connection, or the connection dropped. */
export class NodeUnavailableError extends Schema.TaggedError<NodeUnavailableError>()(
  "NodeUnavailableError",
  { detail: Schema.String },
) {}

export class GatewayProtocolError extends Schema.TaggedError<GatewayProtocolError>()(
  "GatewayProtocolError",
  { detail: Schema.String },
) {}

/** The node answered with an HTTP error status. `status` is the node's own status. */
export class NodeRequestFailed extends Schema.TaggedError<NodeRequestFailed>()(
  "NodeRequestFailed",
  {
    nodeId: NodeId,
    status: Schema.Int,
    detail: Schema.String,
  },
) {}

/** The node answered, but the body did not match the protocol schema. */
export class NodeResponseInvalid extends Schema.TaggedError<NodeResponseInvalid>()(
  "NodeResponseInvalid",
  {
    nodeId: NodeId,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type NodeTransportError = NodeUnavailableError | NodeRequestFailed | NodeResponseInvalid;

export class WorkerError extends Schema.TaggedError<WorkerError>()("WorkerError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
