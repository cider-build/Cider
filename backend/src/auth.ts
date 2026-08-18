import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer, organization } from "better-auth/plugins";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

export interface AuthenticationSession {
  readonly userId: string;
  readonly email: string;
  readonly activeOrganizationId: string | undefined;
}

export interface AuthenticationApi {
  readonly handler: (request: Request) => Promise<Response>;
  readonly session: (
    headers: Readonly<Record<string, string | undefined>>,
  ) => Effect.Effect<AuthenticationSession | null, AuthenticationOperationError>;
}

export class Authentication extends Context.Service<Authentication, AuthenticationApi>()(
  "cider/Authentication",
) {}

class AuthenticationInitializationError extends Schema.TaggedError<AuthenticationInitializationError>()(
  "AuthenticationInitializationError",
  { cause: Schema.Defect() },
) {}

export class AuthenticationOperationError extends Schema.TaggedError<AuthenticationOperationError>()(
  "AuthenticationOperationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const AuthSecret = Schema.Redacted(Schema.String.check(Schema.isMinLength(32)));

const initializationError = (cause: unknown) =>
  new AuthenticationInitializationError({ cause });

const webHeaders = (input: Readonly<Record<string, string | undefined>>) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
};

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const databasePath = yield* Config.nonEmptyString("CIDER_DATABASE_PATH");
    const secret = yield* Config.schema(AuthSecret, "BETTER_AUTH_SECRET");
    const baseUrl = yield* Config.url("BETTER_AUTH_URL");
    const allowedOrigin = yield* Config.url("CIDER_ALLOWED_ORIGIN");

    const database = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new DatabaseSync(databasePath),
        catch: initializationError,
      }),
      (connection) => Effect.sync(() => connection.close()),
    );

    yield* Effect.try({
      try: () => {
        database.exec("PRAGMA foreign_keys = ON");
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA busy_timeout = 5000");
      },
      catch: initializationError,
    });

    const auth = yield* Effect.try({
      try: () =>
        betterAuth({
          appName: "Cider",
          database,
          secret: Redacted.value(secret),
          baseURL: baseUrl.origin,
          basePath: "/api/auth",
          trustedOrigins: [allowedOrigin.origin],
          emailAndPassword: { enabled: true },
          advanced: {
            cookiePrefix: "cider",
            database: { generateId: () => randomUUID().replaceAll("-", "") },
          },
          plugins: [bearer(), organization({ organizationLimit: 1 })],
        }),
      catch: initializationError,
    });

    yield* Effect.tryPromise({
      try: async () => {
        const migrations = await getMigrations(auth.options);
        await migrations.runMigrations();
      },
      catch: initializationError,
    }).pipe(Effect.withSpan("Authentication.migrate"));

    const session = Effect.fn("Authentication.session")(function* (
      headers: Readonly<Record<string, string | undefined>>,
    ) {
      const requestHeaders = webHeaders(headers);
      const result = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers: requestHeaders }),
        catch: (cause) =>
          new AuthenticationOperationError({ operation: "getSession", cause }),
      });
      if (
        result === null
        || result.session.activeOrganizationId === null
        || result.session.activeOrganizationId === undefined
      ) {
        return result === null
          ? null
          : {
              userId: result.user.id,
              email: result.user.email,
              activeOrganizationId: undefined,
            };
      }
      const member = yield* Effect.tryPromise({
        try: () => auth.api.getActiveMember({ headers: requestHeaders }),
        catch: (cause) =>
          new AuthenticationOperationError({ operation: "getActiveMember", cause }),
      });
      return {
        userId: result.user.id,
        email: result.user.email,
        activeOrganizationId: member.organizationId,
      };
    });

    return Authentication.of({ handler: auth.handler, session });
  }),
);
