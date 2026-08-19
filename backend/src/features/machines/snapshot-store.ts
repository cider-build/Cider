import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";

import type { OrganizationId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { type MachineNotFound, MachineStorageError, notFound } from "./errors.ts";

const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

class FileOperationFailure extends Schema.TaggedError<FileOperationFailure>()(
  "FileOperationFailure",
  { cause: Schema.Defect() },
) {}

const expandHome = (path: string) =>
  path === "~"
    ? homedir()
    : path.startsWith("~/")
      ? join(homedir(), path.slice(2))
      : resolve(path);

const fileFailure = (operation: string, detail: string) =>
  Effect.mapError((cause: unknown) => new MachineStorageError({ operation, detail, cause }));

type ReadError = MachineStorageError | MachineNotFound;

const tryFile = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new FileOperationFailure({ cause }),
  });

const accessFile = async (path: string): Promise<boolean> => {
  await fs.access(path, constants.F_OK);
  return true;
};

const decodeJsonArray = Schema.decodeUnknownOption(Schema.Array(Schema.Json));
const decodeJsonObject = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Json),
);
const decodeJsonString = Schema.decodeUnknownOption(Schema.String);
const SystemError = Schema.Struct({ code: Schema.String });
const decodeSystemError = Schema.decodeUnknownOption(SystemError);

const isMissingFile = (failure: FileOperationFailure): boolean =>
  Option.exists(decodeSystemError(failure.cause), (error) => error.code === "ENOENT");

const collectDigests = (value: Schema.Json, output: Set<string>): void => {
  const array = decodeJsonArray(value);
  if (Option.isSome(array)) {
    for (const item of array.value) collectDigests(item, output);
    return;
  }
  const object = decodeJsonObject(value);
  if (Option.isNone(object)) return;
  for (const key of Object.keys(object.value)) {
    const item = object.value[key];
    if (item === undefined) continue;
    const text = decodeJsonString(item);
    if (key === "digest" && Option.isSome(text)) {
      output.add(text.value);
    } else {
      collectDigests(item, output);
    }
  }
};

export interface SnapshotStoreApi {
  readonly write: (
    organizationId: OrganizationId,
    key: string,
    manifest: Schema.Json,
  ) => Effect.Effect<void, MachineStorageError>;
  readonly read: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<Schema.Json, ReadError>;
  readonly delete: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<void, ReadError>;
  readonly discard: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<void, MachineStorageError>;
  readonly exists: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<boolean, MachineStorageError>;
  readonly size: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<number | null, ReadError>;
}

export class SnapshotStore extends Context.Service<SnapshotStore, SnapshotStoreApi>()(
  "cider/features/machines/SnapshotStore",
) {
  static readonly layer = Layer.effect(
    SnapshotStore,
    Effect.gen(function* () {
      const root = expandHome(yield* Config.nonEmptyString("CIDER_SNAPSHOT_STORAGE"));
      const ids = yield* IdGenerator;
      const organizationRoot = (organizationId: OrganizationId) =>
        join(root, organizationId);
      const manifestPath = (organizationId: OrganizationId, key: string) =>
        join(organizationRoot(organizationId), "manifests", `${key}.json`);
      const isDigest = Schema.is(Digest);
      const blobPath = (organizationId: OrganizationId, digest: string) =>
        join(organizationRoot(organizationId), "blobs", digest);

      const existsPath = Effect.fn("SnapshotStore.existsPath")((path: string) =>
        tryFile(() => accessFile(path)).pipe(
          Effect.catchIf(isMissingFile, () => Effect.succeed(false)),
          fileFailure("SnapshotStore.existsPath", "snapshot storage could not be read"),
        ),
      );

      const write = Effect.fn("SnapshotStore.write")(function* (
        organizationId: OrganizationId,
        key: string,
        manifest: Schema.Json,
      ) {
        const destination = manifestPath(organizationId, key);
        const temporary = `${destination}.${yield* ids.uuid}.tmp`;
        yield* tryFile(async () => {
          await fs.mkdir(dirname(destination), { recursive: true });
          const handle = await fs.open(temporary, "wx");
          try {
            await handle.writeFile(JSON.stringify(manifest));
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, destination);
        }).pipe(
          Effect.ensuring(
            tryFile(() => fs.rm(temporary, { force: true })).pipe(Effect.ignore),
          ),
          fileFailure("SnapshotStore.write", "snapshot metadata could not be saved"),
        );
      });

      const read = Effect.fn("SnapshotStore.read")(function* (
        organizationId: OrganizationId,
        key: string,
      ) {
        const path = manifestPath(organizationId, key);
        if (!(yield* existsPath(path))) {
          return yield* notFound("snapshot manifest not found");
        }
        const value = yield* tryFile(() => fs.readFile(path, "utf8")).pipe(
          fileFailure("SnapshotStore.read", "snapshot manifest could not be read"),
        );
        return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(value).pipe(
          fileFailure("SnapshotStore.read", "snapshot manifest is invalid"),
        );
      });

      const deleteManifest = Effect.fn("SnapshotStore.delete")(function* (
        organizationId: OrganizationId,
        key: string,
      ) {
        const path = manifestPath(organizationId, key);
        if (!(yield* existsPath(path))) {
          return yield* notFound("snapshot manifest not found");
        }
        yield* tryFile(() => fs.unlink(path)).pipe(
          fileFailure("SnapshotStore.delete", "snapshot manifest could not be deleted"),
        );
      });

      const discard = Effect.fn("SnapshotStore.discard")((
        organizationId: OrganizationId,
        key: string,
      ) =>
        tryFile(() =>
          fs.rm(manifestPath(organizationId, key), { force: true }),
        ).pipe(
          fileFailure("SnapshotStore.discard", "snapshot manifest could not be discarded"),
        ),
      );

      const exists = Effect.fn("SnapshotStore.exists")((
        organizationId: OrganizationId,
        key: string,
      ) => existsPath(manifestPath(organizationId, key)));

      const size = Effect.fn("SnapshotStore.size")(function* (
        organizationId: OrganizationId,
        key: string,
      ) {
        const path = manifestPath(organizationId, key);
        if (!(yield* existsPath(path))) return null;
        const manifest = yield* read(organizationId, key);
        const digests = new Set<string>();
        collectDigests(manifest, digests);
        // Digests that do not match the blob format have no blob on disk; skip them.
        const sizes = yield* Effect.forEach(
          [...digests].filter(isDigest),
          (digest) =>
            tryFile(() => fs.stat(blobPath(organizationId, digest))).pipe(
              Effect.map((stat) => stat.size),
              Effect.orElseSucceed(() => 0),
            ),
        );
        return sizes.reduce((total, size) => total + size, 0);
      });

      return SnapshotStore.of({
        write,
        read,
        delete: deleteManifest,
        discard,
        exists,
        size,
      });
    }),
  );
}
