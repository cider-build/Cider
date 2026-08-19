import { Context, Effect, Layer, Schema } from "effect";

import type { NodeId, OrganizationId } from "../../domain/ids.ts";
import { VmId } from "../../domain/ids.ts";
import { IdGenerator } from "../../services/id-generator.ts";
import type { NodeTransportError } from "../gateway/errors.ts";
import {
  decodeNodeJson,
  NodeTransport,
} from "../gateway/node-transport.ts";
import {
  CommandResult,
  NodeVmList,
  PortableSnapshotResponse,
  StorageUsageResponse,
} from "./contracts.ts";
import {
  type MachineNotFound,
  MachineOperationFailed,
  type MachineStorageError,
} from "./errors.ts";
import { SnapshotStore } from "./snapshot-store.ts";

const LaunchPayload = Schema.Struct({
  setup: Schema.optionalKey(Schema.Array(Schema.String)),
  start: Schema.optionalKey(Schema.String),
});
type LaunchPayload = Schema.Schema.Type<typeof LaunchPayload>;
const CreatedVm = Schema.Struct({ id: VmId });

type LifecycleError = NodeTransportError;
type SnapshotError = MachineStorageError | MachineNotFound;

export interface MachineLifecycleApi {
  readonly execute: (
    nodeId: NodeId,
    vmId: VmId,
    command: string,
  ) => Effect.Effect<CommandResult, LifecycleError>;
  readonly measureStorage: (
    nodeId: NodeId,
    vmId: VmId,
  ) => Effect.Effect<number, LifecycleError>;
  readonly exportVm: (
    nodeId: NodeId,
    vmId: VmId,
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<void, LifecycleError | SnapshotError | MachineOperationFailed>;
  readonly restoreVm: (
    nodeId: NodeId,
    vmId: VmId,
    organizationId: OrganizationId,
    key: string,
  ) => Effect.Effect<void, LifecycleError | SnapshotError>;
  readonly vmState: (
    nodeId: NodeId,
    vmId: VmId,
  ) => Effect.Effect<string | null, LifecycleError>;
  readonly startVm: (
    nodeId: NodeId,
    vmId: VmId,
  ) => Effect.Effect<void, LifecycleError>;
  readonly deleteVm: (
    nodeId: NodeId,
    vmId: VmId,
  ) => Effect.Effect<void, LifecycleError>;
  readonly uploadArchive: (
    nodeId: NodeId,
    vmId: VmId,
    upload: {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly contentType: string;
    },
  ) => Effect.Effect<void, LifecycleError>;
  readonly createFromArchive: (
    nodeId: NodeId,
    upload: {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly contentType: string;
    },
  ) => Effect.Effect<VmId, LifecycleError>;
  readonly createVm: (nodeId: NodeId) => Effect.Effect<VmId, LifecycleError>;
  readonly runLaunch: (
    nodeId: NodeId,
    vmId: VmId,
    setup?: ReadonlyArray<string>,
    start?: string | null,
  ) => Effect.Effect<void, LifecycleError>;
  readonly applyLaunchConfiguration: (
    nodeId: NodeId,
    vmId: VmId,
    configuration: Schema.Json,
  ) => Effect.Effect<void, LifecycleError>;
  readonly portableSnapshot: (
    nodeId: NodeId,
    vmId: VmId,
    snapshotId: string,
  ) => Effect.Effect<Schema.Json, LifecycleError>;
}

const multipartArchive = (
  boundary: string,
  upload: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly contentType: string;
  },
) => {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="${upload.filename.replaceAll("\"", "%22")}"\r\nContent-Type: ${upload.contentType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const output = new Uint8Array(prefix.length + upload.bytes.length + suffix.length);
  output.set(prefix, 0);
  output.set(upload.bytes, prefix.length);
  output.set(suffix, prefix.length + upload.bytes.length);
  return output;
};

export class MachineLifecycle extends Context.Service<
  MachineLifecycle,
  MachineLifecycleApi
>()("cider/features/machines/MachineLifecycle") {
  static readonly layer = Layer.effect(
    MachineLifecycle,
    Effect.gen(function* () {
      const transport = yield* NodeTransport;
      const snapshots = yield* SnapshotStore;
      const ids = yield* IdGenerator;

      const execute = Effect.fn("MachineLifecycle.execute")(function* (
        nodeId: NodeId,
        vmId: VmId,
        command: string,
      ) {
        const response = yield* transport.request(
          nodeId,
          "POST",
          `/sandboxes/${vmId}/execute`,
          { json: { command } },
        );
        return yield* decodeNodeJson(response, CommandResult, "MachineLifecycle.execute");
      });

      const measureStorage = Effect.fn("MachineLifecycle.measureStorage")(function* (
        nodeId: NodeId,
        vmId: VmId,
      ) {
        const response = yield* transport.request(
          nodeId,
          "GET",
          `/sandboxes/${vmId}/storage-usage`,
        );
        const reading = yield* decodeNodeJson(
          response,
          StorageUsageResponse,
          "MachineLifecycle.measureStorage",
        );
        return reading.used_bytes;
      });

      const portableSnapshot = Effect.fn("MachineLifecycle.portableSnapshot")(function* (
        nodeId: NodeId,
        vmId: VmId,
        snapshotId: string,
      ) {
        const response = yield* transport.request(
          nodeId,
          "POST",
          `/sandboxes/${vmId}/portable-snapshots`,
          { json: { snapshot: snapshotId } },
        );
        const decoded = yield* decodeNodeJson(
          response,
          PortableSnapshotResponse,
          "MachineLifecycle.portableSnapshot",
        );
        return decoded.manifest;
      });

      const deleteVm = Effect.fn("MachineLifecycle.deleteVm")((
        nodeId: NodeId,
        vmId: VmId,
      ) =>
        transport.request(nodeId, "DELETE", `/sandboxes/${vmId}`).pipe(Effect.asVoid),
      );

      const exportVm = Effect.fn("MachineLifecycle.exportVm")(function* (
        nodeId: NodeId,
        vmId: VmId,
        organizationId: OrganizationId,
        key: string,
      ) {
        const manifest = yield* portableSnapshot(nodeId, vmId, yield* ids.uuid);
        yield* snapshots.write(organizationId, key, manifest).pipe(
          Effect.tapError(() => snapshots.discard(organizationId, key).pipe(Effect.ignore)),
        );
        yield* deleteVm(nodeId, vmId).pipe(
          Effect.mapError((cause) =>
            new MachineOperationFailed({
              operation: "MachineLifecycle.exportVm.delete",
              detail: "the export was saved, but removing its stopped VM failed",
              cause,
            }),
          ),
        );
      });

      const restoreVm = Effect.fn("MachineLifecycle.restoreVm")(function* (
        nodeId: NodeId,
        vmId: VmId,
        organizationId: OrganizationId,
        key: string,
      ) {
        const manifest = yield* snapshots.read(organizationId, key);
        yield* transport.request(nodeId, "POST", `/sandboxes/${vmId}/restore`, {
          json: { manifest },
        }).pipe(Effect.asVoid);
      });

      const vmState = Effect.fn("MachineLifecycle.vmState")(function* (
        nodeId: NodeId,
        vmId: VmId,
      ) {
        const response = yield* transport.request(nodeId, "GET", "/sandboxes");
        const vms = yield* decodeNodeJson(response, NodeVmList, "MachineLifecycle.vmState");
        return vms.find((vm) => vm.id === vmId)?.status ?? null;
      });

      const startVm = Effect.fn("MachineLifecycle.startVm")((
        nodeId: NodeId,
        vmId: VmId,
      ) =>
        transport.request(nodeId, "POST", `/sandboxes/${vmId}/start`).pipe(Effect.asVoid),
      );

      const sendArchive = Effect.fn("MachineLifecycle.sendArchive")(function* (
        nodeId: NodeId,
        path: string,
        upload: Parameters<MachineLifecycleApi["uploadArchive"]>[2],
      ) {
        const boundary = `cider-${yield* ids.uuid}`;
        const body = multipartArchive(boundary, upload);
        return yield* transport.request(nodeId, "POST", path, {
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
          body,
        });
      });

      const uploadArchive = Effect.fn("MachineLifecycle.uploadArchive")((
        nodeId: NodeId,
        vmId: VmId,
        upload: Parameters<MachineLifecycleApi["uploadArchive"]>[2],
      ) => sendArchive(nodeId, `/sandboxes/${vmId}/upload`, upload).pipe(Effect.asVoid));

      const createFromArchive = Effect.fn("MachineLifecycle.createFromArchive")(function* (
        nodeId: NodeId,
        upload: Parameters<MachineLifecycleApi["createFromArchive"]>[1],
      ) {
        const response = yield* sendArchive(nodeId, "/sandboxes", upload);
        const decoded = yield* decodeNodeJson(
          response,
          CreatedVm,
          "MachineLifecycle.createFromArchive",
        );
        return decoded.id;
      });

      const createVm = Effect.fn("MachineLifecycle.createVm")(function* (
        nodeId: NodeId,
      ) {
        const response = yield* transport.request(nodeId, "POST", "/sandboxes");
        const decoded = yield* decodeNodeJson(response, CreatedVm, "MachineLifecycle.createVm");
        return decoded.id;
      });

      const runLaunch = Effect.fn("MachineLifecycle.runLaunch")(function* (
        nodeId: NodeId,
        vmId: VmId,
        setup?: ReadonlyArray<string>,
        start?: string | null,
      ) {
        const send = (payload: LaunchPayload) =>
          transport.request(nodeId, "POST", `/sandboxes/${vmId}/launch-config`, {
            json: payload,
          }).pipe(Effect.asVoid);
        if (setup !== undefined && setup.length > 0) {
          if (start !== undefined && start !== null && start !== "") {
            yield* send({ setup, start });
            return;
          }
          yield* send({ setup });
          return;
        }
        if (start !== undefined && start !== null && start !== "") {
          yield* send({ start });
        }
      });

      const applyLaunchConfiguration = Effect.fn(
        "MachineLifecycle.applyLaunchConfiguration",
      )((nodeId: NodeId, vmId: VmId, configuration: Schema.Json) =>
        transport.request(nodeId, "POST", `/sandboxes/${vmId}/launch-config`, {
          json: configuration,
        }).pipe(Effect.asVoid),
      );

      return MachineLifecycle.of({
        execute,
        measureStorage,
        exportVm,
        restoreVm,
        vmState,
        startVm,
        deleteVm,
        uploadArchive,
        createFromArchive,
        createVm,
        runLaunch,
        applyLaunchConfiguration,
        portableSnapshot,
      });
    }),
  );
}
