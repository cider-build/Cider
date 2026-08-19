import { gunzipSync } from "node:zlib";
import { Effect, Option, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import { LaunchConfiguration } from "./contracts.ts";
import { inputRejected } from "./errors.ts";

const textDecoder = new TextDecoder();
const configNames = ["cider.yaml", "cider.yml"] as const;
const JsonObject = Schema.Record(Schema.String, Schema.Json);
const ResourcesEnvelope = Schema.Struct({
  resources: Schema.optionalKey(Schema.Json),
});
const MinimumStorageEnvelope = Schema.Struct({
  min_storage: Schema.optionalKey(Schema.Json),
});
const PositiveStorageBytes = Schema.Int.check(Schema.isGreaterThan(0));
const decodeResources = Schema.decodeUnknownOption(ResourcesEnvelope);
const decodeMinimumStorage = Schema.decodeUnknownOption(MinimumStorageEnvelope);
const decodePositiveStorageBytes = Schema.decodeUnknownOption(PositiveStorageBytes);
const decodeStorageText = Schema.decodeUnknownOption(Schema.String);
const storageUnit = (unit: string): number => {
  switch (unit.toLowerCase()) {
    case "kb":
      return 1024;
    case "mb":
      return 1024 ** 2;
    case "gb":
      return 1024 ** 3;
    case "tb":
      return 1024 ** 4;
    default:
      throw new Error("invalid storage unit");
  }
};

const storageStringBytes = (value: string): number | null => {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)\s*$/i.exec(value);
  if (match === null) return null;
  const amount = match[1];
  const unit = match[2];
  if (amount === undefined || unit === undefined) return null;
  return Math.trunc(Number.parseFloat(amount) * storageUnit(unit));
};

export interface ParsedLaunchArchive {
  readonly launchConfiguration: LaunchConfiguration | null;
  readonly rawConfiguration: Schema.Json | null;
  readonly minStorageBytes: number | null;
}

const parseTar = (archive: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const tar = gunzipSync(archive);
  const entries = new Map<string, Uint8Array>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const nullAt = header.subarray(0, 100).indexOf(0);
    const name = textDecoder.decode(header.subarray(0, nullAt === -1 ? 100 : nullAt));
    const sizeText = textDecoder.decode(header.subarray(124, 136)).replaceAll("\0", "").trim();
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("invalid tar entry size");
    const type = header[156];
    const normalized = name.startsWith("./") ? name.slice(2) : name;
    const parts = normalized.split("/");
    if (
      parts.length <= 2
      && configNames.some((configName) => configName === parts.at(-1))
      && (type === 0 || type === 48)
    ) {
      const configName = parts.at(-1);
      if (configName !== undefined && !entries.has(configName)) {
        entries.set(configName, tar.subarray(offset + 512, offset + 512 + size));
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
};

const minStorageBytes = (configuration: Schema.Json): number | null => {
  const outer = decodeResources(configuration);
  if (Option.isNone(outer) || outer.value.resources === undefined) return null;
  const resources = decodeMinimumStorage(outer.value.resources);
  if (Option.isNone(resources) || resources.value.min_storage === undefined) return null;
  const value = resources.value.min_storage;
  const bytes = decodePositiveStorageBytes(value);
  if (Option.isSome(bytes)) return bytes.value;
  const text = decodeStorageText(value);
  if (Option.isSome(text)) {
    const parsed = storageStringBytes(text.value);
    if (parsed !== null) return parsed;
  }
  throw new Error("resources.min_storage must be bytes or a size like \"60GB\"");
};

export const parseLaunchArchive = Effect.fn("LaunchArchive.parse")(function* (
  archive: Uint8Array,
) {
  const entries = yield* Effect.try({
    try: () => parseTar(archive),
    catch: (cause) =>
      inputRejected(`archive could not be parsed: ${String(cause)}`, cause),
  });
  for (const name of configNames) {
    const contents = entries.get(name);
    if (contents === undefined) continue;
    const jsonText = yield* Effect.try({
      try: () => {
        return JSON.stringify(parseYaml(textDecoder.decode(contents)));
      },
      catch: (cause) =>
        inputRejected(`${name} could not be parsed: ${String(cause)}`, cause),
    });
    const rawConfiguration = yield* Schema.decodeEffect(
      Schema.fromJsonString(JsonObject),
    )(jsonText).pipe(
      Effect.mapError((cause) =>
        inputRejected(`${name} must be a mapping`, cause),
      ),
    );
    const launchConfiguration = yield* Schema.decodeEffect(LaunchConfiguration)(
      rawConfiguration,
    ).pipe(
      Effect.mapError((cause) =>
        inputRejected(`${name} has an invalid launch configuration`, cause),
      ),
    );
    const storage = yield* Effect.try({
      try: () => minStorageBytes(rawConfiguration),
      catch: (cause) =>
        inputRejected(String(cause instanceof Error ? cause.message : cause), cause),
    });
    return {
      launchConfiguration,
      rawConfiguration,
      minStorageBytes: storage,
    };
  }
  return {
    launchConfiguration: null,
    rawConfiguration: null,
    minStorageBytes: null,
  };
});
