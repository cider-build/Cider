import { Context, DateTime, Effect, Layer } from "effect";

import type {
  NodeId,
  OrganizationId,
  SnapshotId } from "../../domain/ids.ts";
import {
  VmId,
} from "../../domain/ids.ts";
import { WarmPool } from "../workers/warm-pool.ts";
import type { SandboxView, SnapshotView } from "./contracts.ts";
import { conflict, type MachineError, MachineOperationFailed } from "./errors.ts";
import { MachineLifecycle } from "./lifecycle.ts";
import {
  MachinePersistence,
  type SnapshotDatabaseRow,
} from "./persistence.ts";
import { SnapshotStore } from "./snapshot-store.ts";

export interface SnapshotServiceApi {
  readonly list: (
    organizationId: OrganizationId,
    includeDeleted: boolean,
  ) => Effect.Effect<ReadonlyArray<SnapshotView>, MachineError>;
  readonly restore: (
    organizationId: OrganizationId,
    id: SnapshotId,
    nodeId?: NodeId,
  ) => Effect.Effect<SandboxView, MachineError>;
  readonly delete: (
    organizationId: OrganizationId,
    id: SnapshotId,
  ) => Effect.Effect<void, MachineError>;
}

export class SnapshotService extends Context.Service<
  SnapshotService,
  SnapshotServiceApi
>()("cider/features/machines/SnapshotService") {
  static readonly layer = Layer.effect(
    SnapshotService,
    Effect.gen(function* () {
      const persistence = yield* MachinePersistence;
      const store = yield* SnapshotStore;
      const lifecycle = yield* MachineLifecycle;
      const warmPool = yield* WarmPool;

      const toView = (snapshot: SnapshotDatabaseRow): SnapshotView => ({
        id: snapshot.id,
        source_sandbox_id: snapshot.sourceSandboxId,
        created_at: snapshot.createdAt,
        deleted_at: snapshot.deletedAt,
        size_bytes: snapshot.deletedAt === null ? snapshot.sizeBytes : null,
      });

      const list = Effect.fn("SnapshotService.list")((
        organizationId: OrganizationId,
        includeDeleted: boolean,
      ) =>
        persistence
          .listSnapshots(organizationId, includeDeleted)
          .pipe(Effect.map((rows) => rows.map(toView))),
      );

      const restore = Effect.fn("SnapshotService.restore")(function* (
        organizationId: OrganizationId,
        id: SnapshotId,
        requestedNodeId?: NodeId,
      ) {
        const snapshot = yield* persistence.getSnapshot(id, organizationId);
        let sandbox = yield* persistence.getSandbox(
          snapshot.sourceSandboxId,
          organizationId,
          false,
        );
        if (sandbox.status !== "stopped") {
          return yield* conflict("sandbox is not stopped");
        }
        const nodeId = yield* warmPool.findCapacityNode(organizationId, requestedNodeId);
        const previousNodeId = sandbox.node_id;
        const sandboxId = sandbox.id;
        const vmId = VmId.make(sandboxId);
        yield* persistence.setSandbox(sandboxId, organizationId, { nodeId, state: "restoring" });
        yield* lifecycle.restoreVm(nodeId, vmId, organizationId, id).pipe(
          Effect.tapError(() =>
            persistence.setSandbox(sandboxId, organizationId, {
              nodeId: previousNodeId,
              state: "stopped",
            }),
          ),
        );
        const now = yield* DateTime.now;
        sandbox = yield* persistence.setSandbox(sandboxId, organizationId, {
          state: "active",
          createdAt: now,
        }).pipe(
          // The VM is restored on the destination node; without a record, remove it again.
          Effect.tapError((cause) =>
            lifecycle.deleteVm(nodeId, vmId).pipe(
              Effect.mapError(
                (cleanup) =>
                  new MachineOperationFailed({
                    operation: "SnapshotService.restore.persist",
                    detail: "restore metadata could not be saved, and destination cleanup also failed",
                    cause: { cause, cleanup },
                  }),
              ),
            ),
          ),
        );
        const launchConfiguration
          = snapshot.launchConfiguration ?? sandbox.launch_config;
        const start = launchConfiguration?.start;
        if (start !== undefined && start !== null) {
          yield* lifecycle.runLaunch(nodeId, VmId.make(sandbox.id), undefined, start);
        }
        yield* warmPool.ensureNode(nodeId);
        return yield* persistence.getSandboxView(sandbox.id, organizationId);
      });

      const deleteSnapshot = Effect.fn("SnapshotService.delete")(function* (
        organizationId: OrganizationId,
        id: SnapshotId,
      ) {
        yield* persistence.getSnapshot(id, organizationId);
        yield* store.discard(organizationId, id);
        const now = yield* DateTime.now;
        yield* persistence.deleteSnapshot(id, organizationId, now);
      });

      return SnapshotService.of({ list, restore, delete: deleteSnapshot });
    }),
  );
}
