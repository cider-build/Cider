import { createHash } from "node:crypto";
import { access, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Config, Context, Effect, Layer, Schema, Stream } from "effect";

import type { OrganizationId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { BlobDigestMismatch, BlobNotFound, BlobStorageError } from "./errors.ts";
import type { BlobDigest } from "./schemas.ts";

const SystemError = Schema.Struct({ code: Schema.String });
const systemError = Schema.decodeUnknownOption(SystemError);

const storageError = (operation: string) => (cause: unknown) =>
  new BlobStorageError({ operation, cause });

const expandHome = (path: string) =>
  path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

const pathExists = (path: string) =>
  Effect.tryPromise({
    try: () => access(path),
    catch: storageError("access"),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("NodeStorage.BlobStorageError", (error) => {
      const decoded = systemError(error.cause);
      if (decoded._tag === "Some" && decoded.value.code === "ENOENT") {
        return Effect.succeed(false);
      }
      return Effect.fail(error);
    }),
  );

const writeTemporary = Effect.fn("NodeStorage.writeTemporary")(function* (
  handle: FileHandle,
  body: Stream.Stream<Uint8Array, unknown>,
  digest: BlobDigest,
) {
  const hasher = createHash("sha256");
  yield* body.pipe(
    Stream.runForEach((chunk) =>
      Effect.tryPromise({
        try: async () => {
          hasher.update(chunk);
          await handle.write(chunk);
        },
        catch: storageError("writeTemporary"),
      }),
    ),
    Effect.mapError((cause) =>
      cause instanceof BlobStorageError
        ? cause
        : new BlobStorageError({ operation: "readRequest", cause }),
    ),
  );
  yield* Effect.tryPromise({
    try: () => handle.sync(),
    catch: storageError("syncTemporary"),
  });
  if (hasher.digest("hex") !== digest) {
    return yield* new BlobDigestMismatch({ digest });
  }
});

export interface NodeStorageServiceApi {
  readonly path: (organizationId: OrganizationId, digest: BlobDigest) => string;
  readonly has: (
    organizationId: OrganizationId,
    digest: BlobDigest,
  ) => Effect.Effect<boolean, BlobStorageError>;
  readonly requirePath: (
    organizationId: OrganizationId,
    digest: BlobDigest,
  ) => Effect.Effect<string, BlobNotFound | BlobStorageError>;
  readonly put: (
    organizationId: OrganizationId,
    digest: BlobDigest,
    body: Stream.Stream<Uint8Array, unknown>,
  ) => Effect.Effect<void, BlobDigestMismatch | BlobStorageError>;
}

export class NodeStorageService extends Context.Service<
  NodeStorageService,
  NodeStorageServiceApi
>()("cider/features/node-storage/NodeStorageService") {}

export const NodeStorageServiceLive = Layer.effect(
  NodeStorageService,
  Effect.gen(function* () {
    const ids = yield* IdGenerator;
    const configuredRoot = yield* Config.nonEmptyString("CIDER_SNAPSHOT_STORAGE");
    const root = expandHome(configuredRoot);
    const blobPath = (organizationId: OrganizationId, digest: BlobDigest) =>
      join(root, organizationId, "blobs", digest);

    const has = Effect.fn("NodeStorage.has")((organizationId: OrganizationId, digest: BlobDigest) =>
      pathExists(blobPath(organizationId, digest)),
    );

    const requirePath = Effect.fn("NodeStorage.requirePath")(function* (
      organizationId: OrganizationId,
      digest: BlobDigest,
    ) {
      const path = blobPath(organizationId, digest);
      if (!(yield* pathExists(path))) {
        return yield* new BlobNotFound({ digest });
      }
      return path;
    });

    const put = Effect.fn("NodeStorage.put")(function* (
      organizationId: OrganizationId,
      digest: BlobDigest,
      body: Stream.Stream<Uint8Array, unknown>,
    ) {
      const destination = blobPath(organizationId, digest);
      if (yield* pathExists(destination)) {
        return;
      }

      yield* Effect.tryPromise({
        try: () => mkdir(dirname(destination), { recursive: true }),
        catch: storageError("mkdir"),
      });
      const temporaryPath = join(dirname(destination), `.upload-${yield* ids.token}`);

      yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => open(temporaryPath, "wx"),
          catch: storageError("openTemporary"),
        }),
        (handle) => writeTemporary(handle, body, digest),
        (handle) =>
          Effect.tryPromise({
            try: () => handle.close(),
            catch: storageError("closeTemporary"),
          }).pipe(Effect.orDie),
      ).pipe(
        Effect.tap(() =>
          Effect.tryPromise({
            try: () => rename(temporaryPath, destination),
            catch: storageError("publishBlob"),
          }),
        ),
        Effect.ensuring(
          Effect.tryPromise({
            try: () => rm(temporaryPath, { force: true }),
            catch: storageError("removeTemporary"),
          }).pipe(Effect.orDie),
        ),
      );
    });

    return NodeStorageService.of({ path: blobPath, has, requirePath, put });
  }),
);
