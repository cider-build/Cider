import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { NodeAuthorization } from "../../http/middleware.ts";
import { BlobDigest } from "./schemas.ts";

const BlobPath = { digest: BlobDigest };

export const BlobUploadUrl = Schema.Struct({
  /** `null` when the blob is already stored, so the node skips the upload. */
  url: Schema.NullOr(Schema.String),
});

export const BlobDownloadUrl = Schema.Struct({ url: Schema.String });

export class NodeStorageApi extends HttpApiGroup.make("nodeStorage")
  .add(
    HttpApiEndpoint.get("uploadUrl", "/blobs/:digest/upload-url", {
      params: BlobPath,
      success: BlobUploadUrl,
    }),
    HttpApiEndpoint.get("downloadUrl", "/blobs/:digest/download-url", {
      params: BlobPath,
      success: BlobDownloadUrl,
    }),
  )
  .middleware(NodeAuthorization)
  .prefix("/node-storage")
  .annotateMerge(
    OpenApi.annotations({
      title: "Node storage",
      description:
        "Presigned object-store URLs for the content-addressed blobs of portable snapshots",
    }),
  ) {}
