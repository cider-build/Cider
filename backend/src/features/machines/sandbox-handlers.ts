import { Effect, Ref, Schema, Stream } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { NodeId } from "../../domain/ids.ts";
import { CiderApi } from "../../http/api.ts";
import { BadRequest, UnprocessableContent } from "../../http/errors.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import type { CreateSandboxUpload } from "./contracts.ts";
import { machineErrors } from "./http.ts";
import { parseLaunchArchive } from "./launch-archive.ts";
import { SandboxService } from "./sandbox-service.ts";

const sandboxForm = Effect.fn("SandboxHandlers.sandboxForm")(function* (
  parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
) {
  const nodeId = yield* Ref.make<string | undefined>(undefined);
  const upload = yield* Ref.make<CreateSandboxUpload | undefined>(undefined);
  yield* parts.pipe(
    Stream.runForEach((part) => {
      if (Multipart.isField(part) && part.key === "node_id") {
        return Ref.set(nodeId, part.value);
      }
      if (Multipart.isFile(part) && part.key === "archive") {
        return part.contentEffect.pipe(
          Effect.flatMap((bytes) =>
            Ref.set(upload, {
              bytes,
              filename: part.name,
              contentType: part.contentType,
            }),
          ),
        );
      }
      return Effect.void;
    }),
    Effect.mapError(() => new BadRequest({ detail: "multipart request could not be parsed" })),
  );
  const rawNodeId = yield* Ref.get(nodeId);
  const parsedNodeId
    = rawNodeId === undefined
      ? undefined
      : yield* Schema.decodeEffect(NodeId)(rawNodeId).pipe(
        Effect.mapError(() => new UnprocessableContent({ detail: "node_id is not a valid node id" })),
      );
  return { nodeId: parsedNodeId, upload: yield* Ref.get(upload) };
});

export const SandboxesHandlers = HttpApiBuilder.group(
  CiderApi,
  "sandboxes",
  Effect.fn("SandboxesHandlers")(function* (handlers) {
    const sandboxes = yield* SandboxService;

    return handlers.handleAll({
      list: Effect.fn(function* () {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes.list(organizationId).pipe(Effect.orDie);
      }),
      get: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes.get(organizationId, params.sandbox_id).pipe(machineErrors);
      }),
      create: Effect.fn(function* ({ payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        const form = yield* sandboxForm(payload);
        const archive
          = form.upload === undefined
            ? undefined
            : {
                upload: form.upload,
                launch: yield* parseLaunchArchive(form.upload.bytes).pipe(machineErrors),
              };
        return yield* sandboxes.create(organizationId, form.nodeId, archive).pipe(machineErrors);
      }),
      snapshot: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes.snapshot(organizationId, params.sandbox_id).pipe(machineErrors);
      }),
      execute: Effect.fn(function* ({ params, payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes
          .execute(organizationId, params.sandbox_id, payload.command)
          .pipe(machineErrors);
      }),
      delete: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        yield* sandboxes.delete(organizationId, params.sandbox_id).pipe(machineErrors);
      }),
      pause: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes.pause(organizationId, params.sandbox_id).pipe(machineErrors);
      }),
      resume: Effect.fn(function* ({ params, payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* sandboxes
          .resume(organizationId, params.sandbox_id, payload?.node_id ?? undefined)
          .pipe(machineErrors);
      }),
    });
  }),
);
