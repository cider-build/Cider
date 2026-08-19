import { Schema } from "effect";

import { NodeId } from "../../domain/ids.ts";

export class NodeNotFound extends Schema.TaggedError<NodeNotFound>()("Nodes.NodeNotFound", {
  nodeId: Schema.String,
}) {}

export class NodeConflict extends Schema.TaggedError<NodeConflict>()("Nodes.NodeConflict", {
  detail: Schema.String,
}) {}

export class NodeConfigurationRejected extends Schema.TaggedError<NodeConfigurationRejected>()(
  "Nodes.NodeConfigurationRejected",
  { detail: Schema.String },
) {}

export class NodePersistenceError extends Schema.TaggedError<NodePersistenceError>()(
  "Nodes.NodePersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class NodeRuntimeError extends Schema.TaggedError<NodeRuntimeError>()(
  "Nodes.NodeRuntimeError",
  { nodeId: NodeId, operation: Schema.String, cause: Schema.Defect() },
) {}

export class NodeConnectionRejected extends Schema.TaggedError<NodeConnectionRejected>()(
  "Nodes.NodeConnectionRejected",
  { detail: Schema.String },
) {}
