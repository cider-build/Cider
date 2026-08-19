import { Effect } from "effect";

import {
  Conflict,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  UnprocessableContent,
} from "../../http/errors.ts";
import type { NodeRequestFailed } from "../gateway/errors.ts";
import type { MachineError } from "./errors.ts";

export type PublicMachineError
  = | NotFound
    | Conflict
    | UnprocessableContent
    | TooManyRequests
    | ServiceUnavailable;

/**
 * A node's own error status is forwarded when it maps to a public error.
 * Other node statuses are internal failures.
 */
const nodeRequestFailed = (
  error: NodeRequestFailed,
): Effect.Effect<never, PublicMachineError> => {
  switch (error.status) {
    case 404:
      return new NotFound({ detail: error.detail });
    case 409:
      return new Conflict({ detail: error.detail });
    case 422:
      return new UnprocessableContent({ detail: error.detail });
    case 429:
      return new TooManyRequests({ detail: error.detail });
    case 503:
      return new ServiceUnavailable({ detail: error.detail });
    default:
      return Effect.die(error);
  }
};

export const machineErrors = <A, R>(
  effect: Effect.Effect<A, MachineError, R>,
): Effect.Effect<A, PublicMachineError, R> =>
  effect.pipe(
    Effect.catchTags({
      "Machines.NotFound": (error) => new NotFound({ detail: error.detail }),
      "Machines.Conflict": (error) => new Conflict({ detail: error.detail }),
      "Machines.InputRejected": (error) => new UnprocessableContent({ detail: error.detail }),
      "Machines.PersistenceError": Effect.die,
      "Machines.StorageError": Effect.die,
      "Machines.OperationFailed": Effect.die,
      "WarmPool.NoEligibleNode": (error) => new NotFound({ detail: error.detail }),
      "WarmPool.InsufficientStorage": (error) =>
        new UnprocessableContent({ detail: error.detail }),
      "WarmPool.CapacityExhausted": (error) => new TooManyRequests({ detail: error.detail }),
      "WarmPool.SandboxesWarming": (error) => new ServiceUnavailable({ detail: error.detail }),
      "WarmPool.PersistenceError": Effect.die,
      "NodeUnavailableError": Effect.die,
      "NodeRequestFailed": nodeRequestFailed,
      "NodeResponseInvalid": Effect.die,
    }),
  );
