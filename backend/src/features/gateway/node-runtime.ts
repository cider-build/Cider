import { Effect, Layer } from "effect";
import { NodeRuntimeError } from "../nodes/errors.ts";
import { NodeRuntime } from "../nodes/runtime.ts";
import { WarmPool } from "../workers/warm-pool.ts";
import { NodeGateway } from "./node-gateway.ts";

export const NodeRuntimeLive = Layer.effect(
  NodeRuntime,
  Effect.gen(function* () {
    const gateway = yield* NodeGateway;
    const warmPool = yield* WarmPool;
    return NodeRuntime.of({
      isConnected: gateway.isConnected,
      disconnect: gateway.disconnect,
      warmingCount: warmPool.warmingCount,
      reconcileNodeWarmPool: (nodeId) =>
        warmPool
          .reconcileNodeWarmPool(nodeId)
          .pipe(
            Effect.mapError(
              (cause) => new NodeRuntimeError({ nodeId, operation: "reconcile", cause }),
            ),
          ),
    });
  }),
);
