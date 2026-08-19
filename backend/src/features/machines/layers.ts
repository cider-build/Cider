import { Layer } from "effect";

import { MachineLifecycle } from "./lifecycle.ts";
import { MachinePersistence } from "./persistence.ts";
import { SandboxService } from "./sandbox-service.ts";
import { ServerService } from "./server-service.ts";
import { SnapshotService } from "./snapshot-service.ts";
import { SnapshotStore } from "./snapshot-store.ts";

const LifecycleLive = MachineLifecycle.layer.pipe(
  Layer.provide(SnapshotStore.layer),
);

const MachineCoreLive = Layer.mergeAll(
  MachinePersistence.layer,
  SnapshotStore.layer,
  LifecycleLive,
);

const MachineUseCasesLive = Layer.mergeAll(
  SandboxService.layer,
  ServerService.layer,
  SnapshotService.layer,
).pipe(Layer.provide(MachineCoreLive));

export const MachineServicesLive = MachineUseCasesLive;
