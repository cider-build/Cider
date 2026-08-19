import { Context, Effect, Layer, Option, Schema } from "effect";

import type { OrganizationId } from "../../domain/ids.ts";
import { ObjectStore } from "../../services/object-store.ts";
import { type MachineNotFound, MachineStorageError, notFound } from "./errors.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const Manifest = Schema.fromJsonString(Schema.Json);
const StoredBytes = Schema.Struct({
  stored_bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const decodeStoredBytes = Schema.decodeUnknownOption(StoredBytes);

const storageError = (operation: string, detail: string) =>
  Effect.mapError((cause: unknown) => new MachineStorageError({ operation, detail, cause }));

/** The compressed size the node reported for a portable snapshot manifest, if it did. */
export const manifestSize = (manifest: Schema.Json): number | null =>
  Option.match(decodeStoredBytes(manifest), {
    onNone: () => null,
    onSome: (fields) => fields.stored_bytes,
  });

/** Portable snapshot manifests, keyed per organization. Blob bytes live under `NodeStorage`. */
export interface SnapshotStoreApi {
  readonly write: (
    organizationId: OrganizationId,
    key: string,
    manifest: Schema.Json,
  ) => Effect.Effect<void, MachineStorageError>;
  readonly read: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<Schema.Json, MachineStorageError | MachineNotFound>;
  readonly discard: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<void, MachineStorageError>;
  readonly exists: (
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<boolean, MachineStorageError>;
}

export class SnapshotStore extends Context.Service<SnapshotStore, SnapshotStoreApi>()(
  "cider/features/machines/SnapshotStore",
) {
  static readonly layer = Layer.effect(
    SnapshotStore,
    Effect.gen(function* () {
      const objects = yield* ObjectStore;
      const manifestKey = (organizationId: OrganizationId, key: string) =>
        `${organizationId}/manifests/${key}.json`;

      const write = Effect.fn("SnapshotStore.write")(
        (organizationId: OrganizationId, key: string, manifest: Schema.Json) =>
          objects
            .put(
              manifestKey(organizationId, key),
              encoder.encode(JSON.stringify(manifest)),
              "application/json",
            )
            .pipe(storageError("SnapshotStore.write", "snapshot metadata could not be saved")),
      );

      const read = Effect.fn("SnapshotStore.read")(function* (
        organizationId: OrganizationId,
        key: string,
      ) {
        const bytes = yield* objects
          .get(manifestKey(organizationId, key))
          .pipe(storageError("SnapshotStore.read", "snapshot manifest could not be read"));
        if (Option.isNone(bytes)) {
          return yield* notFound("snapshot manifest not found");
        }
        return yield* Schema.decodeEffect(Manifest)(decoder.decode(bytes.value)).pipe(
          storageError("SnapshotStore.read", "snapshot manifest is invalid"),
        );
      });

      const discard = Effect.fn("SnapshotStore.discard")(
        (organizationId: OrganizationId, key: string) =>
          objects
            .delete(manifestKey(organizationId, key))
            .pipe(
              storageError("SnapshotStore.discard", "snapshot manifest could not be discarded"),
            ),
      );

      const exists = Effect.fn("SnapshotStore.exists")(
        (organizationId: OrganizationId, key: string) =>
          objects
            .exists(manifestKey(organizationId, key))
            .pipe(storageError("SnapshotStore.exists", "snapshot storage could not be read")),
      );

      return SnapshotStore.of({ write, read, discard, exists });
    }),
  );
}
