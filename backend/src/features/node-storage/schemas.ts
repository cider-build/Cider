import { Schema } from "effect";

export const BlobDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("BlobDigest"),
);

export type BlobDigest = typeof BlobDigest.Type;
