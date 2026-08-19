import { NodeHttpClient } from "@effect/platform-node";
import { Layer } from "effect";

import { RequestAuthorization } from "../auth/access.ts";
import { DatabaseLive } from "../database/live.ts";
import { IdGenerator } from "../services/id-generator.ts";
import { ObjectStore } from "../services/object-store.ts";
import {
  NodeGatewayLive,
  NodeRuntimeLive,
  NodeTransportLive,
  SshTargets,
} from "./gateway/index.ts";
import { MachineServicesLive } from "./machines/index.ts";
import { Metrics } from "./metrics/index.ts";
import { NodeStorageServiceLive } from "./node-storage/index.ts";
import { NodeServiceLive } from "./nodes/index.ts";
import {
  TurnstileVerifierLive,
  WaitlistServiceLive,
} from "./waitlist/index.ts";
import {
  InFlightLive,
  MaintenanceLive,
  WarmPoolLive,
  WorkersLive,
} from "./workers/index.ts";

const FoundationLive = Layer.mergeAll(DatabaseLive, IdGenerator.layer);

const ObjectStoreLive = ObjectStore.layer.pipe(Layer.provide(NodeHttpClient.layerUndici));

const AuthorizationLive = RequestAuthorization.layer.pipe(
  Layer.provide(DatabaseLive),
);

const GatewayLive = NodeGatewayLive.pipe(Layer.provide(IdGenerator.layer));

const TransportLive = NodeTransportLive.pipe(Layer.provide(GatewayLive));

const SshTargetsLive = SshTargets.layer.pipe(
  Layer.provide(Layer.mergeAll(DatabaseLive, GatewayLive)),
);

const WarmPoolServiceLive = WarmPoolLive.pipe(
  Layer.provide(Layer.mergeAll(FoundationLive, TransportLive)),
);

const NodeRuntimeServiceLive = NodeRuntimeLive.pipe(
  Layer.provide(Layer.mergeAll(GatewayLive, WarmPoolServiceLive)),
);

const NodesLive = NodeServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(FoundationLive, NodeRuntimeServiceLive),
  ),
);

const MetricsLive = Metrics.layer.pipe(Layer.provide(FoundationLive));

const MachinesLive = MachineServicesLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      FoundationLive,
      TransportLive,
      WarmPoolServiceLive,
      InFlightLive,
      ObjectStoreLive,
    ),
  ),
);

const NodeStorageLive = NodeStorageServiceLive.pipe(Layer.provide(ObjectStoreLive));

const WaitlistLive = WaitlistServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(FoundationLive, TurnstileVerifierLive),
  ),
);

const MaintenanceServiceLive = MaintenanceLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      DatabaseLive,
      TransportLive,
      WarmPoolServiceLive,
      InFlightLive,
      MetricsLive,
    ),
  ),
);

const BackgroundWorkersLive = WorkersLive.pipe(
  Layer.provide(MaintenanceServiceLive),
);

export const FeatureServicesLive = Layer.mergeAll(
  FoundationLive,
  AuthorizationLive,
  GatewayLive,
  TransportLive,
  SshTargetsLive,
  WarmPoolServiceLive,
  InFlightLive,
  NodeRuntimeServiceLive,
  NodesLive,
  NodeStorageLive,
  TurnstileVerifierLive,
  WaitlistLive,
  MetricsLive,
  MachinesLive,
  MaintenanceServiceLive,
  BackgroundWorkersLive,
);
