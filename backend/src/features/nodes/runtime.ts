import { Context, type Effect } from "effect";

import type { NodeId } from "../../domain/ids.ts";
import type { NodeRuntimeError } from "./errors.ts";

export interface NodeRuntimeApi {
  readonly isConnected: (nodeId: NodeId) => Effect.Effect<boolean>;
  readonly disconnect: (nodeId: NodeId) => Effect.Effect<void, NodeRuntimeError>;
  readonly warmingCount: (nodeId: NodeId) => Effect.Effect<number>;
  readonly reconcileNodeWarmPool: (nodeId: NodeId) => Effect.Effect<void, NodeRuntimeError>;
}

/**
 * The gateway and warm-pool implementation provide this adapter during root composition.
 */
export class NodeRuntime extends Context.Service<NodeRuntime, NodeRuntimeApi>()(
  "cider/features/nodes/NodeRuntime",
) {}
