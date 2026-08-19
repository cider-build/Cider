import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE node (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organization(id),
    name TEXT NOT NULL,
    hardware_model TEXT,
    chip TEXT,
    macos_version TEXT,
    cpu_count INTEGER,
    memory_bytes INTEGER,
    storage_total_bytes INTEGER,
    storage_available_bytes INTEGER,
    vm_count INTEGER NOT NULL CHECK (vm_count IN (1, 2)),
    sandbox_cpu_count INTEGER,
    sandbox_memory_bytes INTEGER,
    sandbox_storage_bytes INTEGER,
    created_at TEXT NOT NULL,
    CONSTRAINT node_name_unique UNIQUE (organization_id, name)
  ) STRICT`;

  yield* sql`CREATE TABLE node_credential (
    node_id TEXT PRIMARY KEY NOT NULL REFERENCES node(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT`;

  yield* sql`CREATE TABLE sandbox (
    id TEXT PRIMARY KEY NOT NULL,
    vm_id TEXT NOT NULL UNIQUE,
    node_id TEXT NOT NULL REFERENCES node(id),
    organization_id TEXT REFERENCES organization(id),
    launch_configuration TEXT,
    storage_used_bytes INTEGER CHECK (storage_used_bytes IS NULL OR storage_used_bytes >= 0),
    state TEXT NOT NULL CHECK (state IN ('warm', 'provisioning', 'active', 'pausing', 'paused', 'restoring', 'stopped')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  ) STRICT`;

  yield* sql`CREATE TABLE server (
    id TEXT PRIMARY KEY NOT NULL,
    vm_id TEXT UNIQUE,
    organization_id TEXT NOT NULL REFERENCES organization(id),
    node_id TEXT NOT NULL REFERENCES node(id),
    name TEXT NOT NULL,
    configuration TEXT NOT NULL,
    storage_used_bytes INTEGER CHECK (storage_used_bytes IS NULL OR storage_used_bytes >= 0),
    state TEXT NOT NULL CHECK (state IN ('provisioning', 'running', 'stopping', 'stopped', 'failed')),
    status_detail TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  ) STRICT`;

  yield* sql`CREATE UNIQUE INDEX server_active_name_unique
    ON server (organization_id, name) WHERE deleted_at IS NULL`;

  yield* sql`CREATE TABLE snapshot (
    id TEXT PRIMARY KEY NOT NULL,
    source_sandbox_id TEXT NOT NULL REFERENCES sandbox(id),
    organization_id TEXT NOT NULL REFERENCES organization(id),
    launch_configuration TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  ) STRICT`;

  yield* sql`CREATE TABLE resource_metric (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organization(id),
    node_id TEXT NOT NULL REFERENCES node(id),
    resource_kind TEXT NOT NULL CHECK (resource_kind IN ('sandbox', 'server')),
    resource_id TEXT NOT NULL,
    cpu_percent REAL NOT NULL,
    memory_percent REAL NOT NULL,
    graphics_memory_bytes INTEGER NOT NULL CHECK (graphics_memory_bytes >= 0),
    collected_at TEXT NOT NULL
  ) STRICT`;

  yield* sql`CREATE TABLE waitlist_entry (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT`;

  yield* sql`CREATE INDEX sandbox_organization_idx ON sandbox(organization_id, created_at DESC)`;
  yield* sql`CREATE INDEX sandbox_node_state_idx ON sandbox(node_id, deleted_at, state)`;
  yield* sql`CREATE INDEX server_organization_idx ON server(organization_id, created_at DESC)`;
  yield* sql`CREATE INDEX server_node_state_idx ON server(node_id, deleted_at, state)`;
  yield* sql`CREATE INDEX snapshot_organization_idx ON snapshot(organization_id, created_at DESC)`;
  yield* sql`CREATE INDEX snapshot_source_idx ON snapshot(source_sandbox_id)`;
  yield* sql`CREATE INDEX resource_metric_node_idx ON resource_metric(node_id)`;
  yield* sql`CREATE INDEX resource_metric_collected_idx ON resource_metric(collected_at)`;
  yield* sql`CREATE INDEX resource_metric_history_idx
    ON resource_metric(organization_id, resource_kind, resource_id, collected_at DESC)`;
});
