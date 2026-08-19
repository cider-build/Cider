import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { NotFound, UnprocessableContent } from "../../http/errors.ts";
import { CurrentNode } from "../../http/middleware.ts";
import { BlobStorageError } from "./errors.ts";
import { NodeStorageService } from "./service.ts";

export const NodeStorageHandlers = HttpApiBuilder.group(
  CiderApi,
  "nodeStorage",
  Effect.fn("NodeStorageHandlers")(function* (handlers) {
    const storage = yield* NodeStorageService;

    return handlers
      .handle(
        "getBlob",
        Effect.fn(function* ({ params, request }) {
          const node = yield* CurrentNode;
          const path = yield* storage.requirePath(node.organizationId, params.digest).pipe(
            Effect.catchTags({
              "NodeStorage.BlobNotFound": () => new NotFound({ detail: "blob not found" }),
              "NodeStorage.BlobStorageError": Effect.die,
            }),
          );
          if (request.method === "HEAD") {
            return HttpServerResponse.empty();
          }
          return yield* HttpServerResponse.file(path, {
            contentType: "application/octet-stream",
          }).pipe(
            Effect.mapError((cause) => new BlobStorageError({ operation: "serveBlob", cause })),
            Effect.orDie,
          );
        }),
      )
      .handleRaw(
        "putBlob",
        Effect.fn(function* ({ params, request }) {
          const node = yield* CurrentNode;
          yield* storage.put(node.organizationId, params.digest, request.stream).pipe(
            Effect.catchTags({
              "NodeStorage.BlobDigestMismatch": () =>
                new UnprocessableContent({ detail: "blob digest does not match its content" }),
              "NodeStorage.BlobStorageError": Effect.die,
            }),
          );
        }),
      );
  }),
);
