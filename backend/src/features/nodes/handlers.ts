import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CiderApi } from "../../http/api.ts";
import { Conflict, NotFound, UnprocessableContent } from "../../http/errors.ts";
import { CurrentPrincipal } from "../../http/middleware.ts";
import type { NodeConfigurationRejected, NodeConflict } from "./errors.ts";
import { NodeService } from "./service.ts";

const notFound = () => new NotFound({ detail: "node not found" });
const conflict = (error: NodeConflict) => new Conflict({ detail: error.detail });
const rejected = (error: NodeConfigurationRejected) =>
  new UnprocessableContent({ detail: error.detail });

export const NodesHandlers = HttpApiBuilder.group(
  CiderApi,
  "nodes",
  Effect.fn("NodesHandlers")(function* (handlers) {
    const nodes = yield* NodeService;

    return handlers.handleAll({
      list: Effect.fn(function* ({ query }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* nodes
          .list(organizationId, query.page ?? 1, query.search ?? "")
          .pipe(Effect.orDie);
      }),
      enroll: Effect.fn(function* ({ payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* nodes.enroll(organizationId, payload).pipe(
          Effect.catchTags({
            "Nodes.NodeConflict": conflict,
            "Nodes.NodePersistenceError": Effect.die,
          }),
        );
      }),
      get: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* nodes.get(organizationId, params.node_id).pipe(
          Effect.catchTags({
            "Nodes.NodeNotFound": notFound,
            "Nodes.NodePersistenceError": Effect.die,
          }),
        );
      }),
      updateConfiguration: Effect.fn(function* ({ params, payload }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* nodes.updateConfiguration(organizationId, params.node_id, payload).pipe(
          Effect.catchTags({
            "Nodes.NodeNotFound": notFound,
            "Nodes.NodeConflict": conflict,
            "Nodes.NodeConfigurationRejected": rejected,
            "Nodes.NodePersistenceError": Effect.die,
            "Nodes.NodeRuntimeError": Effect.die,
          }),
        );
      }),
      delete: Effect.fn(function* ({ params }) {
        const { organizationId } = yield* CurrentPrincipal;
        return yield* nodes.delete(organizationId, params.node_id).pipe(
          Effect.catchTags({
            "Nodes.NodeNotFound": notFound,
            "Nodes.NodeConflict": conflict,
            "Nodes.NodePersistenceError": Effect.die,
            "Nodes.NodeRuntimeError": Effect.die,
          }),
        );
      }),
    });
  }),
);
