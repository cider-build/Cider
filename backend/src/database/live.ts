import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Config, Effect, Layer, String as StringEffect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { Authentication } from "../auth.ts";

const migrationsDirectory = fileURLToPath(new URL("./migrations", import.meta.url));

const makeDatabaseLayer = (filename: string) => {
  const client = SqliteClient.layer({
    filename,
    transformQueryNames: StringEffect.camelToSnake,
    transformResultNames: StringEffect.snakeToCamel,
  });

  const foreignKeys = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON`;
    }),
  ).pipe(Layer.provideMerge(client));

  const migrations = SqliteMigrator.layer({
    loader: SqliteMigrator.fromFileSystem(migrationsDirectory),
  }).pipe(Layer.provide(NodeServices.layer));

  return migrations.pipe(Layer.provideMerge(foreignKeys));
};

export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    yield* Authentication;
    const filename = yield* Config.nonEmptyString("CIDER_DATABASE_PATH");
    return makeDatabaseLayer(filename);
  }),
);

export const makeTestDatabase = (filename: string) => makeDatabaseLayer(filename);
