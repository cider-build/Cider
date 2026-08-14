import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  getNode,
  getSandbox,
  getServer,
  pauseSandbox,
  resumeSandbox,
  retryServer,
  startServer,
  stopServer,
} from "../../api";
import type { Server } from "../../api";
import { OS_RELEASES } from "../../image-catalog";
import { Button, StatusText } from "../ui/ui";
import {
  DetailHead,
  DetailPane,
  DetailTabs,
  Facts,
  Signals,
} from "../ui/detail";
import { isTransitional, pollAfterAction, sandboxName } from "../ui/names";
import { ResourceTerminal } from "../resource-terminal/resource-terminal";
import { ResourceMetrics } from "./resource-metrics";
import styles from "./resource-detail-page.module.css";

type ResourceKind = "server" | "sandbox";
type ResourceTab = "overview" | "metrics" | "terminal";

function label(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function created(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function age(value: string) {
  const hours = (Date.now() - new Date(value).getTime()) / 3_600_000;
  if (hours >= 24) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${Math.floor(hours)}h`;
  return `${Math.max(1, Math.round(hours * 60))}m`;
}

function bytes(value: number | null) {
  if (value === null) return "—";
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function macos(image: string | undefined) {
  if (image === undefined) return "—";
  const release = OS_RELEASES.find((item) => image.includes(item.id));
  return release ? `${release.version} ${release.name}` : image;
}

function useResourceAction(
  fn: (resourceId: string) => Promise<unknown>,
  kind: ResourceKind,
  id: string,
  queryClient: ReturnType<typeof useQueryClient>,
  onFired: () => void,
) {
  return useMutation({
    mutationFn: () => fn(id),
    onMutate: onFired,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [kind, id, "detail"] });
      await queryClient.invalidateQueries({ queryKey: [`${kind}s`] });
    },
  });
}

function ResourceDetailPage({
  kind,
  id,
  tab,
}: {
  kind: ResourceKind;
  id: string;
  tab: ResourceTab;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = kind === "server" ? "/servers" : "/sandboxes";
  const [actedAt, setActedAt] = useState<number | null>(null);
  const fired = () => setActedAt(Date.now());

  const detail = useQuery({
    queryKey: [kind, id, "detail"],
    queryFn: async () => {
      const resource =
        kind === "server" ? await getServer(id) : await getSandbox(id);
      const node = await getNode(resource.node_id);
      return { resource, node };
    },
    refetchInterval: (query) => {
      const status = query.state.data?.resource.status;
      if (status !== undefined && isTransitional(status)) return 2000;
      return pollAfterAction(actedAt);
    },
  });

  const start = useResourceAction(startServer, kind, id, queryClient, fired);
  const stop = useResourceAction(stopServer, kind, id, queryClient, fired);
  const retry = useResourceAction(retryServer, kind, id, queryClient, fired);
  const pause = useResourceAction(pauseSandbox, kind, id, queryClient, fired);
  const resume = useResourceAction(resumeSandbox, kind, id, queryClient, fired);

  if (detail.status === "pending")
    return <section className={styles.state}>Loading resource</section>;
  if (detail.error)
    return (
      <section className={`${styles.state} ${styles.error}`} role="alert">
        {detail.error.message}
      </section>
    );

  const { resource, node } = detail.data;
  const server = kind === "server" ? (resource as Server) : null;
  const status =
    resource.deleted_at === null ? label(resource.status) : "Deleted";
  const running =
    resource.deleted_at === null &&
    (kind === "server"
      ? resource.status === "running"
      : resource.status === "active");
  const allocation = node.configuration;

  const title =
    server !== null ? server.name : sandboxName(resource.id).slice(0, 24);
  const moving =
    resource.deleted_at === null && isTransitional(resource.status);
  const busy =
    start.isPending ||
    stop.isPending ||
    retry.isPending ||
    pause.isPending ||
    resume.isPending;

  const controls =
    kind === "server" ? (
      <>
        {resource.status === "failed" && (
          <Button
            disabled={busy}
            loading={retry.isPending}
            onClick={() => retry.mutate()}
          >
            Retry
          </Button>
        )}
        {resource.status === "running" ? (
          <Button
            disabled={busy || moving}
            loading={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop
          </Button>
        ) : (
          <Button
            disabled={busy || moving || resource.status !== "stopped"}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            Start
          </Button>
        )}
      </>
    ) : resource.status === "paused" ? (
      <Button
        disabled={busy || moving}
        loading={resume.isPending}
        onClick={() => resume.mutate()}
      >
        Resume
      </Button>
    ) : (
      <Button
        disabled={busy || moving || resource.status !== "active"}
        loading={pause.isPending}
        onClick={() => pause.mutate()}
      >
        Pause
      </Button>
    );

  return (
    <section>
      <DetailHead
        title={title}
        id={resource.id}
        parent={{
          label: node.name,
          onOpen: () => navigate(`/nodes/${node.id}`),
        }}
        actions={
          <>
            <Button kind="quiet" onClick={() => navigate(base)}>
              ← {kind === "server" ? "Servers" : "Sandboxes"}
            </Button>
            {resource.deleted_at === null && controls}
          </>
        }
      />
      <DetailTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "metrics", label: "Metrics" },
          {
            id: "terminal",
            label: "Terminal",
            disabled: !running,
            title: running
              ? undefined
              : `Start this ${kind} to open a terminal.`,
          },
        ]}
        active={tab}
        onSelect={(next) =>
          navigate(
            next === "overview" ? `${base}/${id}` : `${base}/${id}/${next}`,
          )
        }
      />
      <DetailPane tabbed>
        {tab === "overview" && (
          <>
            {server?.status_detail != null && (
              <p className={styles.notice} role="status">
                {server.status_detail}
              </p>
            )}
            <Signals
              items={[
                {
                  label: "CPU",
                  value:
                    allocation === null
                      ? "—"
                      : `${allocation.sandbox_cpu_count} cores`,
                },
                {
                  label: "Memory",
                  value:
                    allocation === null
                      ? "—"
                      : bytes(allocation.sandbox_memory_bytes),
                },
                {
                  label: "Disk used",
                  value: bytes(resource.storage_used_bytes),
                },
                { label: "Age", value: age(resource.created_at) },
              ]}
            />
            <Facts
              items={[
                ["State", <StatusText key="s" label={status} />],
                ["Created", created(resource.created_at)],
                ["Node", node.name],
                ...(server !== null
                  ? [
                      ["Operating system", macos(server.config?.image)] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
                ["Age", age(resource.created_at)],
                ["Disk used", bytes(resource.storage_used_bytes)],
                ...(resource.deleted_at !== null
                  ? [
                      ["Deleted", created(resource.deleted_at)] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
              ]}
            />
          </>
        )}
        {tab === "metrics" && (
          <ResourceMetrics kind={kind} id={id} running={running} />
        )}
        {tab === "terminal" && (
          <ResourceTerminal kind={kind} resourceId={id} available={running} />
        )}
      </DetailPane>
    </section>
  );
}

function required(value: string | undefined, name: string) {
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}

export function ServerDetailPage() {
  return (
    <ResourceDetailPage
      kind="server"
      id={required(useParams().serverId, "serverId")}
      tab="overview"
    />
  );
}
export function ServerMetricsPage() {
  return (
    <ResourceDetailPage
      kind="server"
      id={required(useParams().serverId, "serverId")}
      tab="metrics"
    />
  );
}
export function ServerTerminalPage() {
  return (
    <ResourceDetailPage
      kind="server"
      id={required(useParams().serverId, "serverId")}
      tab="terminal"
    />
  );
}
export function SandboxDetailPage() {
  return (
    <ResourceDetailPage
      kind="sandbox"
      id={required(useParams().sandboxId, "sandboxId")}
      tab="overview"
    />
  );
}
export function SandboxMetricsPage() {
  return (
    <ResourceDetailPage
      kind="sandbox"
      id={required(useParams().sandboxId, "sandboxId")}
      tab="metrics"
    />
  );
}
export function SandboxTerminalPage() {
  return (
    <ResourceDetailPage
      kind="sandbox"
      id={required(useParams().sandboxId, "sandboxId")}
      tab="terminal"
    />
  );
}
