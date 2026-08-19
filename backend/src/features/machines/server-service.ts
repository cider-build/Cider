import { Context, DateTime, Effect, Layer, Option } from "effect";

import type {
  NodeId,
  OrganizationId,
  ServerId,
  VmId,
} from "../../domain/ids.ts";
import { NodeTransport } from "../gateway/node-transport.ts";
import { InFlight } from "../workers/in-flight.ts";
import { WarmPool } from "../workers/warm-pool.ts";
import type {
  CreateServerInput,
  ServerConfiguration,
  ServerConfigurationInput,
  ServerView,
} from "./contracts.ts";
import { conflict, inputRejected, type MachineError } from "./errors.ts";
import { MachineLifecycle } from "./lifecycle.ts";
import {
  MachinePersistence,
  type ServerDatabaseRow,
} from "./persistence.ts";
import { SnapshotStore } from "./snapshot-store.ts";

const ENSURE_BREW
  = "command -v brew >/dev/null || NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
const BREW_ON_PATH
  = "grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile";
const LAUNCH_GATEWAY = "nohup openclaw gateway >/tmp/openclaw.log 2>&1 &";

const knownSoftware = new Set(["claude-code", "codex", "cursor", "openclaw"]);

const commandsForSoftware = (name: string): ReadonlyArray<string> => {
  switch (name) {
    case "claude-code":
      return ["brew install node", "npm install -g @anthropic-ai/claude-code"];
    case "codex":
      return ["brew install node", "npm install -g @openai/codex"];
    case "cursor":
      return ["brew install --cask cursor"];
    case "openclaw":
      return [
        "brew install node",
        "export PATH=/opt/homebrew/bin:$PATH; curl -fsSL https://openclaw.ai/install.sh | bash",
      ];
    default:
      throw new Error(`unknown software: ${name}`);
  }
};

const telegramChannel = {
  enabled: true,
  botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
} as const;
const discordChannel = {
  enabled: true,
  token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
} as const;
const slackChannel = {
  enabled: true,
  mode: "socket",
  appToken: { source: "env", provider: "default", id: "SLACK_APP_TOKEN" },
  botToken: { source: "env", provider: "default", id: "SLACK_BOT_TOKEN" },
} as const;

const channelConfiguration = (name: string) => {
  switch (name) {
    case "telegram":
      return telegramChannel;
    case "discord":
      return discordChannel;
    case "slack":
      return slackChannel;
    default:
      return undefined;
  }
};

const defaultConfiguration: ServerConfiguration = {
  image: "macos-26",
  software: [],
  channels: [],
  env: {},
  setup: null,
  start: null,
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const isStringArray = (
  value: string | ReadonlyArray<string>,
): value is ReadonlyArray<string> => Array.isArray(value);

const normalizedConfiguration = (
  configuration: ServerConfigurationInput | null | undefined,
): ServerConfiguration => ({
  image: configuration?.image ?? defaultConfiguration.image,
  software: configuration?.software ?? [],
  channels: configuration?.channels ?? [],
  env: configuration?.env ?? {},
  setup: configuration?.setup ?? null,
  start: configuration?.start ?? null,
});

const provisionCommands = (
  configuration: ServerConfiguration,
): readonly [ReadonlyArray<string>, string | null] => {
  const software = [...configuration.software];
  const channelEntries = configuration.channels.flatMap((name) => {
    const channel = channelConfiguration(name);
    return channel === undefined ? [] : [[name, channel] as const];
  });
  const configuredChannels = Object.fromEntries(channelEntries);
  if (configuration.channels.length > 0 && !software.includes("openclaw")) {
    software.push("openclaw");
  }
  const commands: Array<string> = [];
  if (software.length > 0) commands.push(ENSURE_BREW, BREW_ON_PATH);
  for (const name of software) {
    for (const command of commandsForSoftware(name)) {
      if (!commands.includes(command)) commands.push(command);
    }
  }
  const env = configuration.env ?? {};
  if (software.includes("openclaw") && Object.keys(env).length > 0) {
    const envFile = Object.entries(env).map(([key, value]) => `${key}=${value}\n`).join("");
    commands.push(
      `mkdir -p ~/.openclaw && printf %s ${shellQuote(envFile)} > ~/.openclaw/.env`,
    );
  }
  if (Object.keys(env).length > 0) {
    const exports = `# cider env\n${Object.entries(env)
      .map(([key, value]) => `export ${key}=${shellQuote(value)}\n`)
      .join("")}`;
    commands.push(
      `grep -q '# cider env' ~/.zprofile 2>/dev/null || printf %s ${shellQuote(exports)} >> ~/.zprofile`,
    );
  }
  if (Object.keys(configuredChannels).length > 0) {
    const pluginEntries = Object.fromEntries(
      Object.keys(configuredChannels)
        .filter((name) => name === "discord" || name === "slack")
        .map((name) => [name, { enabled: true }]),
    );
    const openclaw = Object.keys(pluginEntries).length === 0
      ? {
          gateway: { mode: "local" },
          channels: configuredChannels,
        }
      : {
          gateway: { mode: "local" },
          channels: configuredChannels,
          plugins: { entries: pluginEntries },
        };
    commands.push(
      `mkdir -p ~/.openclaw && printf %s ${shellQuote(JSON.stringify(openclaw))} > ~/.openclaw/openclaw.json`,
      LAUNCH_GATEWAY,
    );
  }
  const setup = configuration.setup;
  if (setup !== undefined && setup !== null) {
    if (isStringArray(setup)) {
      commands.push(...setup);
    } else {
      commands.push(setup);
    }
  }
  return [commands, configuration.start ?? null];
};

const relaunchCommands = (
  configuration: ServerConfiguration,
): readonly [ReadonlyArray<string>, string | null] => [
  configuration.channels.some((name) => channelConfiguration(name) !== undefined)
    ? [LAUNCH_GATEWAY]
    : [],
  configuration.start ?? null,
];

const storageKey = (id: ServerId) => `server-${id}`;

const background = (task: Effect.Effect<void, MachineError>) =>
  task.pipe(
    Effect.tapError((error) => Effect.logError("ServerService.background_task_failed", error)),
    Effect.ignore,
  );

/** A short, user-facing summary of a lifecycle failure for `status_detail`. */
const failureDetail = (error: MachineError): string =>
  ("detail" in error ? error.detail : `${error._tag}: ${error.operation}`).slice(0, 2000);

const logIgnored = (message: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) => Effect.logWarning(message, error)),
    Effect.ignore,
  );

export interface ServerServiceApi {
  readonly list: (
    organizationId: OrganizationId,
    includeDeleted: boolean,
  ) => Effect.Effect<ReadonlyArray<ServerView>, MachineError>;
  readonly create: (
    organizationId: OrganizationId,
    input: CreateServerInput,
  ) => Effect.Effect<ServerView, MachineError>;
  readonly get: (
    organizationId: OrganizationId,
    id: ServerId,
  ) => Effect.Effect<ServerView, MachineError>;
  readonly stop: (
    organizationId: OrganizationId,
    id: ServerId,
  ) => Effect.Effect<ServerView, MachineError>;
  readonly start: (
    organizationId: OrganizationId,
    id: ServerId,
  ) => Effect.Effect<ServerView, MachineError>;
  readonly retry: (
    organizationId: OrganizationId,
    id: ServerId,
  ) => Effect.Effect<ServerView, MachineError>;
  readonly delete: (
    organizationId: OrganizationId,
    id: ServerId,
  ) => Effect.Effect<void, MachineError>;
}

export class ServerService extends Context.Service<ServerService, ServerServiceApi>()(
  "cider/features/machines/ServerService",
) {
  static readonly layer = Layer.effect(
    ServerService,
    Effect.gen(function* () {
      const persistence = yield* MachinePersistence;
      const lifecycle = yield* MachineLifecycle;
      const warmPool = yield* WarmPool;
      const snapshots = yield* SnapshotStore;
      const transport = yield* NodeTransport;
      const inFlight = yield* InFlight;

      const view = (row: ServerDatabaseRow) => persistence.toServerView(row);

      const setStatus = Effect.fn("ServerService.setStatus")(function* (
        id: ServerId,
        state: ServerDatabaseRow["state"],
        statusDetail: string | null,
        nodeId?: NodeId,
      ) {
        if (nodeId === undefined) {
          return yield* persistence.setServer(id, { state, statusDetail });
        }
        return yield* persistence.setServer(id, { state, statusDetail, nodeId });
      });

      /** Creates the VM when the server has none. Returns `None` when the server vanished meanwhile. */
      const ensureVm = Effect.fn("ServerService.ensureVm")(function* (
        serverId: ServerId,
        nodeId: NodeId,
        current: VmId | null,
      ) {
        if (current !== null) return Option.some(current);
        const created = yield* lifecycle.createVm(nodeId).pipe(
          Effect.ensuring(warmPool.releaseReservation(nodeId)),
        );
        const updated = yield* persistence.setServer(serverId, { vmId: created });
        if (Option.isNone(updated)) {
          yield* lifecycle.deleteVm(nodeId, created).pipe(
            logIgnored("ServerService.orphan_vm_cleanup_failed"),
          );
          return Option.none<VmId>();
        }
        return Option.some(created);
      });

      const provision = Effect.fn("ServerService.provision")(function* (
        serverId: ServerId,
        nodeId: NodeId,
      ) {
        const original = yield* persistence.findServer(serverId);
        if (Option.isNone(original)) return;
        const server = original.value;
        const provisioned = yield* ensureVm(serverId, nodeId, server.vmId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(Option.none<{ vmId: VmId; used: number }>()),
              onSome: (vmId) =>
                Effect.gen(function* () {
                  const [commands, start] = provisionCommands(server.configuration);
                  yield* lifecycle.runLaunch(nodeId, vmId, commands, start);
                  const used = yield* lifecycle.measureStorage(nodeId, vmId);
                  return Option.some({ vmId, used });
                }),
            }),
          ),
          Effect.tapError((error) => setStatus(serverId, "failed", failureDetail(error))),
          Effect.catch((error) =>
            Effect.logError("ServerService.provision_failed", error).pipe(
              Effect.as(Option.none<{ vmId: VmId; used: number }>()),
            ),
          ),
        );
        if (Option.isNone(provisioned)) return;
        const { vmId, used } = provisioned.value;
        yield* persistence.setServer(serverId, { storageUsedBytes: used });
        const updated = yield* setStatus(serverId, "running", null);
        if (Option.isNone(updated)) {
          yield* lifecycle.deleteVm(nodeId, vmId).pipe(
            logIgnored("ServerService.orphan_vm_cleanup_failed"),
          );
        }
      });

      const list = Effect.fn("ServerService.list")((
        organizationId: OrganizationId,
        includeDeleted: boolean,
      ) => persistence.listServers(organizationId, includeDeleted));

      const get = Effect.fn("ServerService.get")(function* (
        organizationId: OrganizationId,
        id: ServerId,
      ) {
        return view(yield* persistence.getServer(id, organizationId));
      });

      const create = Effect.fn("ServerService.create")(function* (
        organizationId: OrganizationId,
        input: CreateServerInput,
      ) {
        const configuration = normalizedConfiguration(input.config);
        const unknown = configuration.software.filter(
          (name) => !knownSoftware.has(name),
        );
        if (unknown.includes("xcode")) {
          return yield* inputRejected("Xcode ships as its own base image and is not available yet");
        }
        if (unknown.length > 0) {
          return yield* inputRejected(`unknown software: ${unknown.join(", ")}`);
        }
        const duplicate = yield* persistence.findActiveServerByName(
          organizationId,
          input.name,
        );
        if (Option.isSome(duplicate)) {
          return yield* conflict(`a server named '${input.name}' already exists`);
        }
        const reservation = yield* warmPool.claimServerVm(
          organizationId,
          input.node_id ?? undefined,
        );
        const [commands, start] = provisionCommands(configuration);
        const needsProvision = commands.length > 0 || start !== null;
        const server = yield* persistence.insertServer({
          organizationId,
          nodeId: reservation.nodeId,
          name: input.name,
          vmId: reservation.vmId,
          configuration,
          state: reservation.vmId === null || needsProvision ? "provisioning" : "running",
        });
        if (server.state === "provisioning") {
          yield* inFlight.run(
            server.id,
            background(provision(server.id, reservation.nodeId)),
          );
        } else if (server.vmId !== null) {
          const used = yield* lifecycle.measureStorage(server.nodeId, server.vmId);
          yield* persistence.setServer(server.id, { storageUsedBytes: used });
        }
        yield* warmPool.ensureNode(reservation.nodeId);
        return view(server);
      });

      const stopTask = Effect.fn("ServerService.stopTask")(function* (
        id: ServerId,
        nodeId: NodeId,
      ) {
        const current = yield* persistence.findServer(id);
        if (Option.isNone(current) || current.value.vmId === null) return;
        const server = current.value;
        const vmId = current.value.vmId;
        yield* Effect.gen(function* () {
          const used = yield* lifecycle.measureStorage(nodeId, vmId);
          yield* persistence.setServer(id, { storageUsedBytes: used });
          yield* lifecycle.exportVm(nodeId, vmId, server.organizationId, storageKey(id));
        }).pipe(
          Effect.tapError(() => setStatus(id, "running", null)),
        );
        yield* setStatus(id, "stopped", null);
        yield* warmPool.ensureNode(nodeId);
      });

      const stop = Effect.fn("ServerService.stop")(function* (
        organizationId: OrganizationId,
        id: ServerId,
      ) {
        const server = yield* persistence.getServer(id, organizationId);
        if (server.state === "stopped") return view(server);
        if (server.state !== "running") {
          return yield* conflict(`server is ${server.state}; it cannot be stopped`);
        }
        const updated = yield* persistence.setServer(id, {
          state: "stopping",
          statusDetail: null,
        });
        if (Option.isNone(updated)) return view(server);
        yield* inFlight.run(id, background(stopTask(id, server.nodeId)));
        return view(updated.value);
      });

      const startTask = Effect.fn("ServerService.startTask")(function* (
        id: ServerId,
        nodeId: NodeId,
        previousNodeId: NodeId,
        restoreExport: boolean,
      ) {
        const current = yield* persistence.findServer(id);
        if (Option.isNone(current) || current.value.vmId === null) return;
        const server = current.value;
        const vmId = current.value.vmId;
        const used = yield* Effect.gen(function* () {
          if (restoreExport) {
            yield* lifecycle.restoreVm(nodeId, vmId, server.organizationId, storageKey(id));
          } else {
            yield* lifecycle.startVm(nodeId, vmId);
          }
          const [commands, start] = relaunchCommands(server.configuration);
          yield* lifecycle.runLaunch(nodeId, vmId, commands, start);
          return yield* lifecycle.measureStorage(nodeId, vmId);
        }).pipe(
          Effect.tapError((error) =>
            setStatus(id, "stopped", `start failed: ${failureDetail(error)}`, previousNodeId),
          ),
        );
        yield* persistence.setServer(id, { storageUsedBytes: used });
        yield* setStatus(id, "running", null);
        yield* snapshots.discard(server.organizationId, storageKey(id));
        yield* warmPool.reconcileNodeWarmPool(nodeId);
      });

      const start = Effect.fn("ServerService.start")(function* (
        organizationId: OrganizationId,
        id: ServerId,
      ) {
        let server = yield* persistence.getServer(id, organizationId);
        if (server.state === "running") return view(server);
        if (server.state !== "stopped") {
          return yield* conflict(`server is ${server.state}; it cannot be started`);
        }
        if (server.vmId === null) {
          return yield* conflict("server VM is unavailable");
        }
        let localState: string | null = null;
        if (yield* transport.isConnected(server.nodeId)) {
          localState = yield* lifecycle.vmState(server.nodeId, server.vmId);
        }
        if (localState === "running") {
          const updated = yield* persistence.setServer(id, {
            state: "running",
            statusDetail: null,
          });
          return Option.isSome(updated) ? view(updated.value) : view(server);
        }
        const restoreExport = localState === null;
        let destination = server.nodeId;
        if (restoreExport) {
          if (!(yield* snapshots.exists(organizationId, storageKey(id)))) {
            return yield* conflict("server VM is unavailable and has no saved export");
          }
          destination = yield* warmPool.findCapacityNode(organizationId);
        } else if (localState !== "stopped") {
          return yield* conflict(`server VM is ${localState}; it cannot be started`);
        }
        const previousNodeId = server.nodeId;
        const updated = yield* persistence.setServer(id, {
          nodeId: destination,
          state: "provisioning",
          statusDetail: null,
        });
        if (Option.isSome(updated)) server = updated.value;
        yield* inFlight.run(
          id,
          background(startTask(id, destination, previousNodeId, restoreExport)),
        );
        return view(server);
      });

      const retry = Effect.fn("ServerService.retry")(function* (
        organizationId: OrganizationId,
        id: ServerId,
      ) {
        const server = yield* persistence.getServer(id, organizationId);
        if (server.state !== "failed") {
          return yield* conflict(`server is ${server.state}; only a failed server can be retried`);
        }
        if (yield* snapshots.exists(organizationId, storageKey(id))) {
          const stopped = yield* persistence.setServer(id, {
            state: "stopped",
            statusDetail: null,
          });
          return Option.isSome(stopped) ? view(stopped.value) : view(server);
        }
        const provisioning = yield* persistence.setServer(id, {
          state: "provisioning",
          statusDetail: null,
        });
        yield* inFlight.run(id, background(provision(id, server.nodeId)));
        return Option.isSome(provisioning) ? view(provisioning.value) : view(server);
      });

      const deleteServer = Effect.fn("ServerService.delete")(function* (
        organizationId: OrganizationId,
        id: ServerId,
      ) {
        const server = yield* persistence.getServer(id, organizationId);
        const now = yield* DateTime.now;
        const deleted = yield* persistence.setServer(id, { deletedAt: now });
        const vmId = Option.isSome(deleted) ? deleted.value.vmId : server.vmId;
        if (server.state === "stopped") {
          yield* snapshots.discard(organizationId, storageKey(id));
        } else if (vmId !== null) {
          yield* lifecycle.deleteVm(server.nodeId, vmId).pipe(
            logIgnored("ServerService.delete_vm_failed"),
          );
        }
        yield* warmPool.ensureNode(server.nodeId);
      });

      return ServerService.of({
        list,
        create,
        get,
        stop,
        start,
        retry,
        delete: deleteServer,
      });
    }),
  );
}
