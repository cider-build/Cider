import { Context } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

import type { NodeId, OrganizationId, UserId } from "../domain/ids.ts";
import { Unauthorized, UnprocessableContent } from "./errors.ts";

export interface Principal {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
}

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "cider/http/CurrentPrincipal",
) {}

export interface NodePrincipal {
  readonly nodeId: NodeId;
  readonly organizationId: OrganizationId;
}

export class CurrentNode extends Context.Service<CurrentNode, NodePrincipal>()(
  "cider/http/CurrentNode",
) {}

export const SessionCookie = HttpApiSecurity.apiKey({
  key: "cider.session_token",
  in: "cookie",
});

/**
 * HTTP API middleware runs inside the router request scope.
 *
 * @effect-expect-leaking HttpServerRequest | ParsedSearchParams | RouteContext
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentPrincipal }
>()("cider/http/Authorization", {
  security: { bearer: HttpApiSecurity.bearer, session: SessionCookie },
  error: Unauthorized,
}) {}

/**
 * HTTP API middleware runs inside the router request scope.
 *
 * @effect-expect-leaking HttpServerRequest | ParsedSearchParams | RouteContext
 */
export class NodeAuthorization extends HttpApiMiddleware.Service<
  NodeAuthorization,
  { provides: CurrentNode }
>()("cider/http/NodeAuthorization", {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()(
  "cider/http/RequestValidation",
  { error: UnprocessableContent },
) {}
