import { createHash } from "node:crypto";
import { Option } from "effect";

/** Parses `Authorization: Bearer <token>`. Returns `None` for any other shape. */
export const parseBearerToken = (authorization: string | undefined): Option.Option<string> => {
  if (authorization === undefined) {
    return Option.none();
  }
  const [scheme, token, extra] = authorization.split(" ");
  const isBearer = scheme?.toLowerCase() === "bearer";
  if (!isBearer || token === undefined || token === "" || extra !== undefined) {
    return Option.none();
  }
  return Option.some(token);
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
