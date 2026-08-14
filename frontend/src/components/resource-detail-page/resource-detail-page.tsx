import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Button, StatusText } from "../ui";
import {
  DetailHead,
  DetailPane,
  DetailTabs,
  Facts,
  Signals,
} from "../detail";
import { isTransitional, pollAfterAction, sandboxName } from "../ui/names";
import { ResourceTerminal } from "../resource-terminal/resource-terminal";
import { ResourceMetrics } from "../resource-metrics/resource-metrics";
import {
  age,
  bytes,
  created,
  label,
  macos,
  required,
  useResourceAction,
} from "./resource-detail-page.utils";
import type {
  ResourceKind,
  ResourceTab,
} from "./resource-detail-page.utils";
import styles from "./resource-detail-page.module.css";

export function ResourceDetailPage({
  kind,
  tab,
}: {
  kind: ResourceKind;
  tab: ResourceTab;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const id = required(
    kind === "server" ? params.serverId : params.sandboxId,
    `${kind}Id`,
  );
  const base = kind === "server" ? "/servers" : "/sandboxes";
  const [actedAt, setActedAt] = useState<number | null>(null);
  const fired = () => setActedAt(Date.now());

  const detail = useQuery({
    queryKey: [kind, id, "detail"],
    queryFn: async () => {
      const resource
        = kind === "server" ? await getServer(id) : await getSandbox(id);
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
  const status
    = resource.deleted_at === null ? label(resource.status) : "Deleted";
  const running
    = resource.deleted_at === null
      && (kind === "server"
        ? resource.status === "running"
        : resource.status === "active");
  const allocation = node.configuration;

  const title
    = server !== null ? server.name : sandboxName(resource.id).slice(0, 24);
  const moving
    = resource.deleted_at === null && isTransitional(resource.status);
  const busy
    = start.isPending
      || stop.isPending
      || retry.isPending
      || pause.isPending
      || resume.isPending;

  const controls
    = kind === "server"
      ? (
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
            {resource.status === "running"
              ? (
                  <Button
                    disabled={busy || moving}
                    loading={stop.isPending}
                    onClick={() => stop.mutate()}
                  >
                    Stop
                  </Button>
                )
              : (
                  <Button
                    disabled={busy || moving || resource.status !== "stopped"}
                    loading={start.isPending}
                    onClick={() => start.mutate()}
                  >
                    Start
                  </Button>
                )}
          </>
        )
      : resource.status === "paused"
        ? (
            <Button
              disabled={busy || moving}
              loading={resume.isPending}
              onClick={() => resume.mutate()}
            >
              Resume
            </Button>
          )
        : (
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
          onOpen: () => {
            void navigate(`/nodes/${node.id}`);
          },
        }}
        actions={(
          <>
            <Button
              kind="quiet"
              onClick={() => {
                void navigate(base);
              }}
            >
              ←
              {" "}
              {kind === "server" ? "Servers" : "Sandboxes"}
            </Button>
            {resource.deleted_at === null && controls}
          </>
        )}
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
        onSelect={(next) => {
          void navigate(
            next === "overview" ? `${base}/${id}` : `${base}/${id}/${next}`,
          );
        }}
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
