import { Effect, Schema } from "effect";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    detail: Schema.String,
  },
) {}

export class RepositoryError extends Schema.TaggedError<RepositoryError>()("RepositoryError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * Builds an operation-labelled error mapper for infrastructure boundaries.
 * Use it right after SQL, file, or transport effects whose only failures are
 * infrastructure failures. Keep the original failure as `cause`.
 */
export const operationError
  = <E>(make: (input: { readonly operation: string; readonly cause: unknown }) => E) =>
    (operation: string) =>
      Effect.mapError((cause: unknown) => make({ operation, cause }));

export const repositoryError = operationError(
  ({ operation, cause }) => new RepositoryError({ operation, cause }),
);
