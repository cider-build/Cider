import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { type RepositoryError, repositoryError } from "../../domain/errors.ts";
import { NodeId, OrganizationId, SandboxId, VmId } from "../../domain/ids.ts";
import type { SshTarget } from "./api.ts";
import { NodeGateway } from "./node-gateway.ts";

const SshTargetRow = Schema.Struct({
  sandboxId: SandboxId,
  vmId: VmId,
  nodeId: NodeId,
  nodeName: Schema.String,
  status: Schema.String,
  serverName: Schema.NullOr(Schema.String),
});
type SshTargetRow = typeof SshTargetRow.Type;

/** A running VM a user may attach a terminal to. */
export const TerminalTarget = Schema.Struct({
  nodeId: NodeId,
  vmId: VmId,
});
export type TerminalTarget = typeof TerminalTarget.Type;

export const TerminalResourceKind = Schema.Literals(["sandbox", "server"]);
export type TerminalResourceKind = typeof TerminalResourceKind.Type;

const ResourceLookup = Schema.Struct({
  organizationId: OrganizationId,
  resourceId: Schema.String,
});

const toSshTarget = (row: SshTargetRow): SshTarget => ({
  sandbox_id: row.sandboxId,
  node_id: row.nodeId,
  node_name: row.nodeName,
  status: row.status,
  server_name: row.serverName,
});

export interface SshTargetsApi {
  /** Active sandboxes and running servers on connected nodes. */
  readonly available: (
    organizationId: OrganizationId,
  ) => Effect.Effect<ReadonlyArray<SshTarget>, RepositoryError>;
  /** One available target by sandbox id. */
  readonly select: (
    organizationId: OrganizationId,
    sandboxId: SandboxId,
  ) => Effect.Effect<Option.Option<SshTarget>, RepositoryError>;
  /** The connected VM behind a sandbox or server id, for the terminal route. */
  readonly terminalTarget: (
    organizationId: OrganizationId,
    kind: TerminalResourceKind,
    resourceId: string,
  ) => Effect.Effect<Option.Option<TerminalTarget>, RepositoryError>;
  /** The connected VM behind a sandbox id or a server VM id, for the SSH route. */
  readonly sshVmTarget: (
    organizationId: OrganizationId,
    resourceId: string,
  ) => Effect.Effect<Option.Option<TerminalTarget>, RepositoryError>;
}

export class SshTargets extends Context.Service<SshTargets, SshTargetsApi>()(
  "cider/features/gateway/SshTargets",
) {
  static readonly layer = Layer.effect(
    SshTargets,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const gateway = yield* NodeGateway;

      const activeSandboxes = SqlSchema.findAll({
        Request: OrganizationId,
        Result: SshTargetRow,
        execute: (organizationId) => sql`
          SELECT
            sandbox.id AS sandbox_id,
            sandbox.vm_id AS vm_id,
            node.id AS node_id,
            node.name AS node_name,
            sandbox.state AS status,
            NULL AS server_name
          FROM sandbox
          JOIN node ON sandbox.node_id = node.id
          WHERE sandbox.organization_id = ${organizationId}
            AND sandbox.deleted_at IS NULL
            AND sandbox.state = 'active'
          ORDER BY sandbox.created_at DESC
        `,
      });
      const runningServers = SqlSchema.findAll({
        Request: OrganizationId,
        Result: SshTargetRow,
        execute: (organizationId) => sql`
          SELECT
            server.vm_id AS sandbox_id,
            server.vm_id AS vm_id,
            node.id AS node_id,
            node.name AS node_name,
            server.state AS status,
            server.name AS server_name
          FROM server
          JOIN node ON server.node_id = node.id
          WHERE server.organization_id = ${organizationId}
            AND server.deleted_at IS NULL
            AND server.state = 'running'
            AND server.vm_id IS NOT NULL
          ORDER BY server.created_at DESC
        `,
      });
      const activeSandboxVm = SqlSchema.findOneOption({
        Request: ResourceLookup,
        Result: TerminalTarget,
        execute: ({ organizationId, resourceId }) => sql`
          SELECT node_id, vm_id FROM sandbox
          WHERE id = ${resourceId}
            AND organization_id = ${organizationId}
            AND deleted_at IS NULL
            AND state = 'active'
          LIMIT 1
        `,
      });
      const runningServerVm = SqlSchema.findOneOption({
        Request: ResourceLookup,
        Result: TerminalTarget,
        execute: ({ organizationId, resourceId }) => sql`
          SELECT node_id, vm_id FROM server
          WHERE id = ${resourceId}
            AND organization_id = ${organizationId}
            AND deleted_at IS NULL
            AND state = 'running'
            AND vm_id IS NOT NULL
          LIMIT 1
        `,
      });
      const sshVm = SqlSchema.findOneOption({
        Request: ResourceLookup,
        Result: TerminalTarget,
        execute: ({ organizationId, resourceId }) => sql`
          SELECT node_id, vm_id FROM sandbox
          WHERE id = ${resourceId}
            AND organization_id = ${organizationId}
            AND deleted_at IS NULL
            AND state = 'active'
          UNION ALL
          SELECT node_id, vm_id FROM server
          WHERE vm_id = ${resourceId}
            AND organization_id = ${organizationId}
            AND deleted_at IS NULL
            AND state = 'running'
          LIMIT 1
        `,
      });

      /** Keeps a target only when its node has a live gateway connection. */
      const connectedOnly = (target: Option.Option<TerminalTarget>) =>
        Option.match(target, {
          onNone: () => Effect.succeed(Option.none<TerminalTarget>()),
          onSome: (value) =>
            gateway.isConnected(value.nodeId).pipe(
              Effect.map((connected) => (connected ? Option.some(value) : Option.none())),
            ),
        });

      const available = Effect.fn("SshTargets.available")(function* (
        organizationId: OrganizationId,
      ) {
        const [sandboxes, servers] = yield* Effect.all([
          activeSandboxes(organizationId),
          runningServers(organizationId),
        ]).pipe(repositoryError("SshTargets.available"));
        const connected = yield* Effect.filter(
          [...sandboxes, ...servers],
          (row) => gateway.isConnected(row.nodeId),
          { concurrency: "unbounded" },
        );
        return connected.map(toSshTarget);
      });

      const select = Effect.fn("SshTargets.select")((
        organizationId: OrganizationId,
        sandboxId: SandboxId,
      ) =>
        available(organizationId).pipe(
          Effect.map((targets) =>
            Option.fromNullishOr(targets.find((target) => target.sandbox_id === sandboxId)),
          ),
        ),
      );

      const terminalTarget = Effect.fn("SshTargets.terminalTarget")((
        organizationId: OrganizationId,
        kind: TerminalResourceKind,
        resourceId: string,
      ) =>
        (kind === "sandbox"
          ? activeSandboxVm({ organizationId, resourceId })
          : runningServerVm({ organizationId, resourceId })
        ).pipe(
          repositoryError("SshTargets.terminalTarget"),
          Effect.flatMap(connectedOnly),
        ),
      );

      const sshVmTarget = Effect.fn("SshTargets.sshVmTarget")((
        organizationId: OrganizationId,
        resourceId: string,
      ) =>
        sshVm({ organizationId, resourceId }).pipe(
          repositoryError("SshTargets.sshVmTarget"),
          Effect.flatMap(connectedOnly),
        ),
      );

      return SshTargets.of({ available, select, terminalTarget, sshVmTarget });
    }),
  );
}
