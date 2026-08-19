import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { NodeId } from "../../domain/ids.ts";
import { Conflict, NotFound, UnprocessableContent } from "../../http/errors.ts";
import { Authorization } from "../../http/middleware.ts";
import {
  NodeConfigurationInput,
  NodeEnrollmentInput,
  NodeEnrollmentOutput,
  NodeOutput,
  NodePage,
} from "./schemas.ts";

const NodePath = { node_id: NodeId };

export class NodesApi extends HttpApiGroup.make("nodes")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: {
        page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
        search: Schema.optional(Schema.String),
      },
      success: NodePage,
    }),
    HttpApiEndpoint.post("enroll", "/enrollments", {
      payload: NodeEnrollmentInput,
      success: NodeEnrollmentOutput.pipe(HttpApiSchema.status(201)),
      error: Conflict,
    }),
    HttpApiEndpoint.get("get", "/:node_id", {
      params: NodePath,
      success: NodeOutput,
      error: NotFound,
    }),
    HttpApiEndpoint.patch("updateConfiguration", "/:node_id/configuration", {
      params: NodePath,
      payload: NodeConfigurationInput,
      success: NodeOutput,
      error: [NotFound, Conflict, UnprocessableContent],
    }),
    HttpApiEndpoint.delete("delete", "/:node_id", {
      params: NodePath,
      error: [NotFound, Conflict],
    }),
  )
  .middleware(Authorization)
  .prefix("/nodes")
  .annotateMerge(
    OpenApi.annotations({
      title: "Nodes",
      description: "Node enrollment, configuration, and removal",
    }),
  ) {}
