import { Schema } from "effect";

import { operationError } from "../../domain/errors.ts";
import type { NodeTransportError } from "../gateway/errors.ts";
import type { WarmPoolError } from "../workers/errors.ts";

export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()(
  "Machines.NotFound",
  { detail: Schema.String },
) {}

export class MachineConflict extends Schema.TaggedError<MachineConflict>()(
  "Machines.Conflict",
  { detail: Schema.String },
) {}

/** The caller's input is well-formed but not acceptable. */
export class MachineInputRejected extends Schema.TaggedError<MachineInputRejected>()(
  "Machines.InputRejected",
  { detail: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export class MachinePersistenceError extends Schema.TaggedError<MachinePersistenceError>()(
  "Machines.PersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

/** Snapshot manifest storage failed. */
export class MachineStorageError extends Schema.TaggedError<MachineStorageError>()(
  "Machines.StorageError",
  { operation: Schema.String, detail: Schema.String, cause: Schema.Defect() },
) {}

/** A multi-step machine operation stopped part-way. `detail` says what did and did not happen. */
export class MachineOperationFailed extends Schema.TaggedError<MachineOperationFailed>()(
  "Machines.OperationFailed",
  { operation: Schema.String, detail: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export const machinePersistenceError = operationError(
  ({ operation, cause }) => new MachinePersistenceError({ operation, cause }),
);

export const notFound = (detail: string) => new MachineNotFound({ detail });
export const conflict = (detail: string) => new MachineConflict({ detail });
export const inputRejected = (detail: string, cause?: unknown) =>
  cause === undefined
    ? new MachineInputRejected({ detail })
    : new MachineInputRejected({ detail, cause });

export type MachineError
  = | MachineNotFound
    | MachineConflict
    | MachineInputRejected
    | MachinePersistenceError
    | MachineStorageError
    | MachineOperationFailed
    | WarmPoolError
    | NodeTransportError;
