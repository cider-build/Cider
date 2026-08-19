import { AwsV4Signer } from "aws4fetch";
import {
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

/** The object store did not complete the request. `cause` keeps the transport failure or the store's reply. */
export class ObjectStoreError extends Schema.TaggedError<ObjectStoreError>()("ObjectStore.Error", {
  operation: Schema.String,
  key: Schema.String,
  cause: Schema.Defect(),
}) {}

type Method = "GET" | "PUT" | "HEAD" | "DELETE";

const succeeded = (status: number) => status >= 200 && status < 300;
/** Reads answer 404 for a missing key; writes never do, so a 404 there is a failure. */
const missingIsAnswer = (method: Method) => method === "GET" || method === "HEAD";

/**
 * Cloudflare R2 through its S3 API. Small objects move through the backend;
 * large objects move through presigned URLs so their bytes never cross this process.
 */
export interface ObjectStoreApi {
  readonly put: (
    key: string,
    body: Uint8Array,
    contentType: string,
  ) => Effect.Effect<void, ObjectStoreError>;
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>, ObjectStoreError>;
  readonly exists: (key: string) => Effect.Effect<boolean, ObjectStoreError>;
  readonly delete: (key: string) => Effect.Effect<void, ObjectStoreError>;
  readonly presign: (
    method: "GET" | "PUT",
    key: string,
    expiresIn: Duration.Duration,
  ) => Effect.Effect<string>;
}

export class ObjectStore extends Context.Service<ObjectStore, ObjectStoreApi>()(
  "cider/ObjectStore",
) {
  static readonly layer = Layer.effect(
    ObjectStore,
    Effect.gen(function* () {
      const endpoint = yield* Config.url("CIDER_R2_ENDPOINT");
      const bucket = yield* Config.nonEmptyString("CIDER_R2_BUCKET");
      const accessKeyId = Redacted.value(yield* Config.redacted("CIDER_R2_ACCESS_KEY_ID"));
      const secretAccessKey = Redacted.value(yield* Config.redacted("CIDER_R2_SECRET_ACCESS_KEY"));
      const client = yield* HttpClient.HttpClient;
      const signingKeys = new Map<string, ArrayBuffer>();

      const objectUrl = (key: string) => new URL(`/${bucket}/${key}`, endpoint);

      const sign = Effect.fn("ObjectStore.sign")(function* (
        method: Method,
        url: URL,
        signQuery: boolean,
      ) {
        const datetime = DateTime.formatIso(yield* DateTime.now).replace(/[:-]|\.\d{3}/g, "");
        const signer = new AwsV4Signer({
          method,
          url: url.href,
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "auto",
          cache: signingKeys,
          datetime,
          signQuery,
        });
        return yield* Effect.promise(() => signer.sign());
      });

      const send = Effect.fn("ObjectStore.send")(function* (
        operation: string,
        method: Method,
        key: string,
        body?: { readonly bytes: Uint8Array; readonly contentType: string },
      ) {
        const signed = yield* sign(method, objectUrl(key), false);
        const request = HttpClientRequest.make(method)(signed.url, { headers: signed.headers });
        const response = yield* client
          .execute(
            body === undefined
              ? request
              : HttpClientRequest.bodyUint8Array(request, body.bytes, body.contentType),
          )
          .pipe(Effect.mapError((cause) => new ObjectStoreError({ operation, key, cause })));
        if (succeeded(response.status) || (response.status === 404 && missingIsAnswer(method))) {
          return response;
        }
        const reply = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* new ObjectStoreError({
          operation,
          key,
          cause: `object store replied ${response.status}: ${reply}`,
        });
      });

      const put = Effect.fn("ObjectStore.put")(
        (key: string, bytes: Uint8Array, contentType: string) =>
          send("ObjectStore.put", "PUT", key, { bytes, contentType }).pipe(Effect.asVoid),
      );

      const get = Effect.fn("ObjectStore.get")(function* (key: string) {
        const response = yield* send("ObjectStore.get", "GET", key);
        if (response.status === 404) return Option.none();
        const buffer = yield* response.arrayBuffer.pipe(
          Effect.mapError(
            (cause) => new ObjectStoreError({ operation: "ObjectStore.get", key, cause }),
          ),
        );
        return Option.some(new Uint8Array(buffer));
      });

      const exists = Effect.fn("ObjectStore.exists")((key: string) =>
        send("ObjectStore.exists", "HEAD", key).pipe(
          Effect.map((response) => response.status !== 404),
        ),
      );

      // S3 DELETE succeeds for missing keys too, so this is idempotent.
      const remove = Effect.fn("ObjectStore.delete")((key: string) =>
        send("ObjectStore.delete", "DELETE", key).pipe(Effect.asVoid),
      );

      const presign = Effect.fn("ObjectStore.presign")(function* (
        method: "GET" | "PUT",
        key: string,
        expiresIn: Duration.Duration,
      ) {
        const url = objectUrl(key);
        url.searchParams.set("X-Amz-Expires", String(Math.floor(Duration.toSeconds(expiresIn))));
        const signed = yield* sign(method, url, true);
        return signed.url.href;
      });

      return ObjectStore.of({ put, get, exists, delete: remove, presign });
    }),
  );
}
