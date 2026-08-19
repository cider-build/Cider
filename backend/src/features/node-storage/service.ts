import { Context, Duration, Effect, Layer, Option } from "effect";

import type { OrganizationId } from "../../domain/ids.ts";
import { ObjectStore, type ObjectStoreError } from "../../services/object-store.ts";
import type { BlobDigest } from "./schemas.ts";

const urlLifetime = Duration.hours(1);

/** Blob bytes move directly between the node and the object store; the backend only signs URLs. */
export interface NodeStorageServiceApi {
  /** A URL the node can `PUT` the blob to, or none when the blob is already stored. */
  readonly uploadUrl: (
    organizationId: OrganizationId,
    digest: BlobDigest,
  ) => Effect.Effect<Option.Option<string>, ObjectStoreError>;
  readonly downloadUrl: (
    organizationId: OrganizationId,
    digest: BlobDigest,
  ) => Effect.Effect<string>;
}

export class NodeStorageService extends Context.Service<
  NodeStorageService,
  NodeStorageServiceApi
>()("cider/features/node-storage/NodeStorageService") {}

export const NodeStorageServiceLive = Layer.effect(
  NodeStorageService,
  Effect.gen(function* () {
    const objects = yield* ObjectStore;
    const blobKey = (organizationId: OrganizationId, digest: BlobDigest) =>
      `${organizationId}/blobs/${digest}`;

    const uploadUrl = Effect.fn("NodeStorage.uploadUrl")(function* (
      organizationId: OrganizationId,
      digest: BlobDigest,
    ) {
      const key = blobKey(organizationId, digest);
      if (yield* objects.exists(key)) return Option.none();
      return Option.some(yield* objects.presign("PUT", key, urlLifetime));
    });

    const downloadUrl = Effect.fn("NodeStorage.downloadUrl")(
      (organizationId: OrganizationId, digest: BlobDigest) =>
        objects.presign("GET", blobKey(organizationId, digest), urlLifetime),
    );

    return NodeStorageService.of({ uploadUrl, downloadUrl });
  }),
);
