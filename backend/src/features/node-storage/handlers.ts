import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { CurrentNode } from "../../http/middleware.ts";
import { NodeStorageService } from "./service.ts";

export const NodeStorageHandlers = HttpApiBuilder.group(
  CiderApi,
  "nodeStorage",
  Effect.fn("NodeStorageHandlers")(function* (handlers) {
    const storage = yield* NodeStorageService;

    return handlers
      .handle(
        "uploadUrl",
        Effect.fn(function* ({ params }) {
          const node = yield* CurrentNode;
          const url = yield* storage
            .uploadUrl(node.organizationId, params.digest)
            .pipe(Effect.orDie);
          return { url: Option.getOrNull(url) };
        }),
      )
      .handle(
        "downloadUrl",
        Effect.fn(function* ({ params }) {
          const node = yield* CurrentNode;
          return { url: yield* storage.downloadUrl(node.organizationId, params.digest) };
        }),
      );
  }),
);
