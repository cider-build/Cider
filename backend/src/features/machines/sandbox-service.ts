import { Context, DateTime, Effect, Layer } from "effect";

import type { NodeId, OrganizationId } from "../../domain/ids.ts";
import { SandboxId, SnapshotId, VmId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import { WarmPool } from "../workers/warm-pool.ts";
import type {
  CommandResult,
  CreateSandboxUpload,
  CreatedSnapshotView,
  SandboxRecord,
  SandboxView,
} from "./contracts.ts";
import { conflict, type MachineError, MachineOperationFailed } from "./errors.ts";
import type { ParsedLaunchArchive } from "./launch-archive.ts";
import { MachineLifecycle } from "./lifecycle.ts";
import { MachinePersistence } from "./persistence.ts";
import { manifestSize, SnapshotStore } from "./snapshot-store.ts";

const pauseKey = (id: SandboxId) => `pause-${id}`;

/** A sandbox id and its VM id share one format. */
const vmIdOf = (id: SandboxId) => VmId.make(id);

export interface ArchiveUpload {
  readonly upload: CreateSandboxUpload;
  readonly launch: ParsedLaunchArchive;
}

export interface SandboxServiceApi {
  readonly list: (
    organizationId: OrganizationId,
  ) => Effect.Effect<ReadonlyArray<SandboxView>, MachineError>;
  readonly get: (
    organizationId: OrganizationId,
    id: SandboxId,
  ) => Effect.Effect<SandboxView, MachineError>;
  readonly create: (
    organizationId: OrganizationId,
    nodeId: NodeId | undefined,
    archive: ArchiveUpload | undefined,
  ) => Effect.Effect<SandboxView, MachineError>;
  readonly execute: (
    organizationId: OrganizationId,
    id: SandboxId,
    command: string,
  ) => Effect.Effect<CommandResult, MachineError>;
  readonly snapshot: (
    organizationId: OrganizationId,
    id: SandboxId,
  ) => Effect.Effect<CreatedSnapshotView, MachineError>;
  readonly delete: (
    organizationId: OrganizationId,
    id: SandboxId,
  ) => Effect.Effect<void, MachineError>;
  readonly pause: (
    organizationId: OrganizationId,
    id: SandboxId,
  ) => Effect.Effect<SandboxView, MachineError>;
  readonly resume: (
    organizationId: OrganizationId,
    id: SandboxId,
    nodeId?: NodeId,
  ) => Effect.Effect<SandboxView, MachineError>;
}

export class SandboxService extends Context.Service<
  SandboxService,
  SandboxServiceApi
>()("cider/features/machines/SandboxService") {
  static readonly layer = Layer.effect(
    SandboxService,
    Effect.gen(function* () {
      const persistence = yield* MachinePersistence;
      const lifecycle = yield* MachineLifecycle;
      const warmPool = yield* WarmPool;
      const snapshots = yield* SnapshotStore;
      const ids = yield* IdGenerator;

      const list = Effect.fn("SandboxService.list")((organizationId: OrganizationId) =>
        persistence.listSandboxes(organizationId),
      );

      const get = Effect.fn("SandboxService.get")((
        organizationId: OrganizationId,
        id: SandboxId,
      ) => persistence.getSandboxView(id, organizationId));

      const owned = Effect.fn("SandboxService.owned")((
        organizationId: OrganizationId,
        id: SandboxId,
      ) => persistence.getSandbox(id, organizationId, false));

      const recordStorage = Effect.fn("SandboxService.recordStorage")(function* (
        organizationId: OrganizationId,
        sandbox: SandboxRecord,
      ) {
        const used = yield* lifecycle.measureStorage(sandbox.node_id, vmIdOf(sandbox.id));
        return yield* persistence.setSandbox(sandbox.id, organizationId, {
          storageUsedBytes: used,
        });
      });

      const createWarm = Effect.fn("SandboxService.createWarm")(function* (
        organizationId: OrganizationId,
        nodeId: NodeId | undefined,
      ) {
        const allocation = yield* warmPool.createSandbox(organizationId, "active", nodeId);
        const sandbox = yield* owned(organizationId, allocation.sandboxId);
        yield* recordStorage(organizationId, sandbox);
        return yield* get(organizationId, sandbox.id);
      });

      /** Upload into a claimed warm VM. On failure, release the VM and refill the pool. */
      const uploadIntoWarm = Effect.fn("SandboxService.uploadIntoWarm")(function* (
        organizationId: OrganizationId,
        nodeId: NodeId,
        vmId: VmId,
        archive: ArchiveUpload,
      ) {
        const sandboxId = SandboxId.make(vmId);
        const releaseVm = Effect.gen(function* () {
          yield* lifecycle.deleteVm(nodeId, vmId).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("SandboxService.upload_cleanup_failed", error).pipe(
                Effect.annotateLogs({ sandboxId }),
              ),
            ),
            Effect.ignore,
          );
          const now = yield* DateTime.now;
          yield* persistence.setSandbox(sandboxId, organizationId, { deletedAt: now });
          yield* warmPool.ensureNode(nodeId);
        });
        yield* lifecycle.uploadArchive(nodeId, vmId, archive.upload).pipe(
          Effect.tapError(() => releaseVm),
        );
        const sandbox = yield* persistence.setSandbox(sandboxId, organizationId, {
          state: "active",
          launchConfiguration: archive.launch.launchConfiguration,
        });
        yield* warmPool.ensureNode(nodeId);
        return sandbox;
      });

      const createFromArchive = Effect.fn("SandboxService.createFromArchive")(function* (
        organizationId: OrganizationId,
        nodeId: NodeId | undefined,
        archive: ArchiveUpload,
      ) {
        const reservation = yield* warmPool.reserveArchiveSandbox(
          organizationId,
          nodeId,
          archive.launch.minStorageBytes ?? undefined,
        );
        const sandbox
          = reservation.vmId === null
            ? yield* lifecycle.createFromArchive(reservation.nodeId, archive.upload).pipe(
              Effect.flatMap((vmId) =>
                persistence.insertSandbox({
                  id: SandboxId.make(vmId),
                  vmId,
                  nodeId: reservation.nodeId,
                  organizationId,
                  launchConfiguration: archive.launch.launchConfiguration,
                  state: "active",
                }),
              ),
            )
            : yield* uploadIntoWarm(organizationId, reservation.nodeId, reservation.vmId, archive);
        if (archive.launch.rawConfiguration !== null) {
          yield* lifecycle.applyLaunchConfiguration(
            sandbox.node_id,
            vmIdOf(sandbox.id),
            archive.launch.rawConfiguration,
          );
        }
        yield* recordStorage(organizationId, sandbox);
        return yield* get(organizationId, sandbox.id);
      });

      const create = Effect.fn("SandboxService.create")((
        organizationId: OrganizationId,
        nodeId: NodeId | undefined,
        archive: ArchiveUpload | undefined,
      ) =>
        archive === undefined
          ? createWarm(organizationId, nodeId)
          : createFromArchive(organizationId, nodeId, archive),
      );

      const execute = Effect.fn("SandboxService.execute")(function* (
        organizationId: OrganizationId,
        id: SandboxId,
        command: string,
      ) {
        const sandbox = yield* owned(organizationId, id);
        if (sandbox.status === "stopped" || sandbox.status === "restoring") {
          return yield* conflict(`sandbox is ${sandbox.status}; wait for it to be available`);
        }
        return yield* lifecycle.execute(sandbox.node_id, vmIdOf(id), command);
      });

      const snapshot = Effect.fn("SandboxService.snapshot")(function* (
        organizationId: OrganizationId,
        id: SandboxId,
      ) {
        let sandbox = yield* owned(organizationId, id);
        if (sandbox.status !== "active") {
          return yield* conflict("snapshots require a running sandbox");
        }
        sandbox = yield* recordStorage(organizationId, sandbox);
        const snapshotId = SnapshotId.make(yield* ids.uuid);
        const manifest = yield* lifecycle.portableSnapshot(
          sandbox.node_id,
          vmIdOf(id),
          snapshotId,
        );
        yield* snapshots.write(organizationId, snapshotId, manifest);
        const stored = yield* persistence.saveSnapshot({
          id: snapshotId,
          sourceSandboxId: id,
          organizationId,
          launchConfiguration: sandbox.launch_config,
          sizeBytes: manifestSize(manifest),
        }).pipe(
          Effect.tapError(() => snapshots.discard(organizationId, snapshotId).pipe(Effect.ignore)),
        );
        yield* lifecycle.deleteVm(sandbox.node_id, vmIdOf(id)).pipe(
          Effect.mapError((cause) =>
            new MachineOperationFailed({
              operation: "SandboxService.snapshot.deleteSource",
              detail: "snapshot was saved, but removing its stopped source VM failed",
              cause,
            }),
          ),
        );
        yield* warmPool.ensureNode(sandbox.node_id);
        return {
          id: stored.id,
          source_sandbox_id: stored.sourceSandboxId,
          org_id: stored.organizationId,
          launch_config: stored.launchConfiguration,
          created_at: stored.createdAt,
          deleted_at: stored.deletedAt,
        };
      });

      const deleteSandbox = Effect.fn("SandboxService.delete")(function* (
        organizationId: OrganizationId,
        id: SandboxId,
      ) {
        const sandbox = yield* owned(organizationId, id);
        const holdsVm = sandbox.status !== "stopped" && sandbox.status !== "paused";
        if (holdsVm) {
          yield* lifecycle.deleteVm(sandbox.node_id, vmIdOf(id));
        }
        if (sandbox.status === "paused") {
          yield* snapshots.discard(organizationId, pauseKey(id));
        }
        const now = yield* DateTime.now;
        yield* persistence.setSandbox(id, organizationId, { deletedAt: now });
        if (holdsVm) {
          yield* warmPool.ensureNode(sandbox.node_id);
        }
      });

      const pause = Effect.fn("SandboxService.pause")(function* (
        organizationId: OrganizationId,
        id: SandboxId,
      ) {
        let sandbox = yield* owned(organizationId, id);
        if (sandbox.status !== "active") {
          return yield* conflict(
            `sandbox is ${sandbox.status}; only a running sandbox can be paused`,
          );
        }
        sandbox = yield* persistence.setSandbox(id, organizationId, { state: "pausing" });
        sandbox = yield* recordStorage(organizationId, sandbox);
        yield* lifecycle.exportVm(sandbox.node_id, vmIdOf(id), organizationId, pauseKey(id)).pipe(
          Effect.tapError(() => persistence.setSandbox(id, organizationId, { state: "active" })),
        );
        yield* persistence.setSandbox(id, organizationId, { state: "paused" });
        yield* warmPool.ensureNode(sandbox.node_id);
        return yield* get(organizationId, id);
      });

      const resume = Effect.fn("SandboxService.resume")(function* (
        organizationId: OrganizationId,
        id: SandboxId,
        requestedNodeId?: NodeId,
      ) {
        let sandbox = yield* owned(organizationId, id);
        if (sandbox.status !== "paused") {
          return yield* conflict(
            `sandbox is ${sandbox.status}; only a paused sandbox can be resumed`,
          );
        }
        const nodeId = yield* warmPool.findCapacityNode(organizationId, requestedNodeId);
        const previousNodeId = sandbox.node_id;
        yield* persistence.setSandbox(id, organizationId, { nodeId, state: "restoring" });
        yield* lifecycle.restoreVm(nodeId, vmIdOf(id), organizationId, pauseKey(id)).pipe(
          Effect.tapError(() =>
            persistence.setSandbox(id, organizationId, { nodeId: previousNodeId, state: "paused" }),
          ),
        );
        const now = yield* DateTime.now;
        sandbox = yield* persistence.setSandbox(id, organizationId, {
          state: "active",
          createdAt: now,
        });
        const start = sandbox.launch_config?.start;
        if (start !== undefined && start !== null) {
          yield* lifecycle.runLaunch(nodeId, vmIdOf(id), undefined, start);
        }
        yield* recordStorage(organizationId, sandbox);
        yield* snapshots.discard(organizationId, pauseKey(id));
        yield* warmPool.ensureNode(nodeId);
        return yield* get(organizationId, id);
      });

      return SandboxService.of({
        list,
        get,
        create,
        execute,
        snapshot,
        delete: deleteSandbox,
        pause,
        resume,
      });
    }),
  );
}
