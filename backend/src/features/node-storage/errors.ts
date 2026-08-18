import { Schema } from "effect";

import { BlobDigest } from "./schemas.ts";

export class BlobNotFound extends Schema.TaggedError<BlobNotFound>()("NodeStorage.BlobNotFound", {
  digest: BlobDigest,
}) {}

export class BlobDigestMismatch extends Schema.TaggedError<BlobDigestMismatch>()(
  "NodeStorage.BlobDigestMismatch",
  { digest: BlobDigest },
) {}

export class BlobStorageError extends Schema.TaggedError<BlobStorageError>()(
  "NodeStorage.BlobStorageError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}
