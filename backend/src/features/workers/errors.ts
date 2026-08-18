import { Schema } from "effect";

import { operationError } from "../../domain/errors.ts";
import type { NodeTransportError } from "../gateway/errors.ts";

/** No connected node matches the request (none registered, or the requested node is unavailable). */
export class NoEligibleNode extends Schema.TaggedError<NoEligibleNode>()(
  "WarmPool.NoEligibleNode",
  { detail: Schema.String },
) {}

/** No connected node offers the storage the launch configuration requires. */
export class InsufficientStorage extends Schema.TaggedError<InsufficientStorage>()(
  "WarmPool.InsufficientStorage",
  { minStorageBytes: Schema.Int, detail: Schema.String },
) {}

/** Every eligible node is at its VM capacity. */
export class CapacityExhausted extends Schema.TaggedError<CapacityExhausted>()(
  "WarmPool.CapacityExhausted",
  { detail: Schema.String },
) {}

/** Capacity exists, but the warm sandboxes are still starting. */
export class SandboxesWarming extends Schema.TaggedError<SandboxesWarming>()(
  "WarmPool.SandboxesWarming",
  { detail: Schema.String },
) {}

export class WarmPoolPersistenceError extends Schema.TaggedError<WarmPoolPersistenceError>()(
  "WarmPool.PersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const warmPoolPersistenceError = operationError(
  ({ operation, cause }) => new WarmPoolPersistenceError({ operation, cause }),
);

export type WarmPoolError
  = | NoEligibleNode
    | InsufficientStorage
    | CapacityExhausted
    | SandboxesWarming
    | WarmPoolPersistenceError
    | NodeTransportError;
