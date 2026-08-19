import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { NotFound, UnprocessableContent } from "../../http/errors.ts";
import { NodeAuthorization } from "../../http/middleware.ts";
import { BlobDigest } from "./schemas.ts";

const BlobPath = { digest: BlobDigest };

export class NodeStorageApi extends HttpApiGroup.make("nodeStorage")
  .add(
    HttpApiEndpoint.get("getBlob", "/blobs/:digest", {
      params: BlobPath,
      success: HttpApiSchema.StreamUint8Array({ contentType: "application/octet-stream" }),
      error: NotFound,
    }),
    HttpApiEndpoint.put("putBlob", "/blobs/:digest", {
      params: BlobPath,
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: UnprocessableContent,
    }),
  )
  .middleware(NodeAuthorization)
  .prefix("/node-storage")
  .annotateMerge(
    OpenApi.annotations({
      title: "Node storage",
      description: "Content-addressed blob storage for portable snapshots",
    }),
  ) {}
