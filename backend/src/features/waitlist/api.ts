import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { BadRequest } from "../../http/errors.ts";
import { WaitlistInput, WaitlistOutput } from "./schemas.ts";

export class WaitlistApi extends HttpApiGroup.make("waitlist")
  .add(
    HttpApiEndpoint.post("join", "/waitlist", {
      payload: WaitlistInput,
      success: WaitlistOutput,
      error: BadRequest,
    }),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Waitlist",
      description: "Public waitlist registration",
    }),
  ) {}
