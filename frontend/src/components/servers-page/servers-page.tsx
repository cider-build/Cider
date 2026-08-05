import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { deleteServer, listServers, retryServer, startServer, stopServer } from "../../api";
import type { Server, ServerConfig } from "../../api";
import { OPENCLAW_CHANNELS, OS_RELEASES, SOFTWARE } from "../../image-catalog";
import { Button } from "../button/button";
import {
  buildSeries,
  EmptyState,
  FixedList,
  ListGrid,
  listClasses,
  Panel,
  RailHero,
  RailSection,
  Spinner,
  StatusText,
} from "../list-page/list-page";
import { PageHeader } from "../page-header/page-header";
import styles from "./servers-page.module.css";

const PER_PAGE = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* Real brand marks only (same sources as prototype L's .applogos). */
const SOFTWARE_LOGOS: Partial<Record<string, string>> = {
  "claude-code": "https://svgl.app/library/claude-ai-icon.svg",
  codex: "https://svgl.app/library/openai.svg",
  cursor: "https://cdn.simpleicons.org/cursor/000000",
};
const CHANNEL_LOGOS: Partial<Record<string, string>> = {
  imessage: "https://cdn.simpleicons.org/imessage/34DA50",
  telegram: "https://cdn.simpleicons.org/telegram/26A5E4",
  whatsapp: "https://cdn.simpleicons.org/whatsapp/25D366",
  discord: "https://cdn.simpleicons.org/discord/5865F2",
  slack: "https://svgl.app/library/slack.svg",
};
const XCODE_LOGO = "https://developer.apple.com/assets/elements/icons/xcode/xcode-128x128_2x.png";

const ICON_STOP = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    <rect x="1" y="1" width="8" height="8" rx="1.5" />
  </svg>
);
const ICON_PLAY = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    <path d="M2.2 1.06c0-.72.78-1.17 1.4-.8l6.55 3.94c.6.36.6 1.24 0 1.6L3.6 9.74a.93.93 0 0 1-1.4-.8z" />
  </svg>
);
const ICON_RETRY = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
const ICON_TRASH = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

function createdAt(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function macosLabel(config: ServerConfig | null) {
  if (!config) return "—";
  const release = OS_RELEASES.find((item) => item.id === config.image);
  return release ? `${release.version} ${release.name}` : config.image;
}

function serverStatus(status: string): { tone: "ok" | "warm" | "gone"; label: string } {
  if (status === "running") return { tone: "ok", label: "Running" };
  if (status === "provisioning") return { tone: "warm", label: "Provisioning" };
  if (status === "stopping") return { tone: "warm", label: "Stopping" };
  if (status === "stopped") return { tone: "warm", label: "Stopped" };
  if (status === "failed") return { tone: "gone", label: "Failed" };
  return { tone: "warm", label: status.charAt(0).toUpperCase() + status.slice(1) };
}

/* L's .applogos cell: brand icons only, a hairline separator before OpenClaw
   channels. "Clean macOS" when the image ships nothing. WebChat has no brand
   mark, so it never renders an icon. */
function SoftwareCell({ config }: { config: ServerConfig | null }) {
  if (!config) return <div className={listClasses.cell}>—</div>;
  const apps = [];
  if (config.software.includes("xcode")) {
    apps.push(<img key="xcode" className={styles.xcode} src={XCODE_LOGO} alt="Xcode" title="Xcode" />);
  }
  for (const id of config.software.filter((item) => item !== "xcode")) {
    const name = SOFTWARE.find((item) => item.id === id)?.name ?? id;
    if (id === "openclaw") {
      apps.push(<span key={id} className={styles.emoji} title={name}>🦞</span>);
    } else {
      const logo = SOFTWARE_LOGOS[id];
      if (logo) apps.push(<img key={id} src={logo} alt={name} title={name} />);
    }
  }
  if (apps.length === 0) return <div className={listClasses.cell}>Clean macOS</div>;
  const channels = config.channels.filter((id) => CHANNEL_LOGOS[id] !== undefined);
  return (
    <div className={styles.applogos}>
      {apps}
      {channels.length > 0 && <span className={styles.sep} />}
      {channels.map((id) => {
        const name = OPENCLAW_CHANNELS.find((channel) => channel.id === id)?.name ?? id;
        return <img key={id} src={CHANNEL_LOGOS[id]} alt={name} title={name} />;
      })}
    </div>
  );
}

export function ServersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["servers"] });
  };
  const stop = useMutation({ mutationFn: stopServer, onSuccess: refresh });
  const start = useMutation({ mutationFn: startServer, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteServer, onSuccess: refresh });
  const retry = useMutation({ mutationFn: retryServer, onSuccess: refresh });
  const actionError = stop.error ?? start.error ?? remove.error ?? retry.error;
  const actionPending = stop.isPending || start.isPending || remove.isPending || retry.isPending;
  const servers = useQuery({
    queryKey: ["servers"],
    queryFn: listServers,
    // A provisioning row resolves server-side; poll until it settles. Also
    // poll while any action request is in flight — the transient status only
    // becomes visible through a refetch, so waiting for it to appear first
    // would never start the polling.
    refetchInterval: (query) =>
      actionPending ||
      query.state.data?.some((server) => server.status === "provisioning" || server.status === "stopping")
        ? 2000
        : false,
  });
  const busyId = stop.isPending
    ? stop.variables
    : start.isPending
      ? start.variables
      : remove.isPending
        ? remove.variables
        : retry.isPending
          ? retry.variables
          : null;

  const header = (
    <PageHeader
      title="Servers"
      lede="Named Macs that keep their disk. Stop one and its files wait for the next start."
      action={
        <Button styleType={Button.Style.Primary} onClick={() => navigate("/servers/new")}>
          Create server
        </Button>
      }
    />
  );

  if (servers.status === "pending") {
    return (
      <section className={styles.page}>
        {header}
        <p className={styles.quiet}>Loading…</p>
      </section>
    );
  }
  if (servers.error) {
    return (
      <section className={styles.page}>
        {header}
        <p className={styles.error} role="alert">{servers.error.message}</p>
      </section>
    );
  }

  // The response includes tombstones for the sparkline; the table shows live rows.
  const history = servers.data;
  const items = servers.data
    .filter((server) => server.deleted_at == null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(page, totalPages - 1);
  const slice = items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const running = items.filter((server) => server.status === "running").length;
  const stopped = items.filter((server) => server.status === "stopped").length;
  const provisioning = items.filter((server) => server.status === "provisioning").length;
  const nodesInUse = new Set(items.map((server) => server.node_id)).size;
  const createdThisWeek = history.filter(
    (server) => Date.now() - new Date(server.created_at).getTime() < WEEK_MS,
  ).length;
  const deletedThisWeek = history.filter(
    (server) => server.deleted_at != null && Date.now() - new Date(server.deleted_at).getTime() < WEEK_MS,
  ).length;
  const fleetRows: Array<[string, number]> = [["Running", running]];
  if (provisioning > 0) fleetRows.push(["Provisioning", provisioning]);
  fleetRows.push(["Stopped", stopped], ["Total", items.length], ["Nodes in use", nodesInUse]);

  function rowActions(server: Server) {
    const busy = busyId === server.id;
    return (
      <div className={styles.acts}>
        {server.status === "failed" && (
          <button
            type="button"
            className={styles.btnIc}
            aria-label={`Retry ${server.name}`}
            aria-busy={busy && retry.isPending}
            title="Retry provisioning"
            disabled={actionPending}
            onClick={() => retry.mutate(server.id)}
          >
            {busy && retry.isPending ? <Spinner size={10} /> : ICON_RETRY}
          </button>
        )}
        {server.status === "running" ? (
          <button
            type="button"
            className={styles.btnIc}
            aria-label={`Stop ${server.name}`}
            aria-busy={busy && stop.isPending}
            title="Stop"
            disabled={actionPending}
            onClick={() => stop.mutate(server.id)}
          >
            {busy && stop.isPending ? <Spinner size={10} /> : ICON_STOP}
          </button>
        ) : (
          <button
            type="button"
            className={styles.btnIc}
            aria-label={`Start ${server.name}`}
            aria-busy={busy && start.isPending}
            title="Start"
            disabled={actionPending || server.status !== "stopped"}
            onClick={() => start.mutate(server.id)}
          >
            {busy && start.isPending ? <Spinner size={10} /> : ICON_PLAY}
          </button>
        )}
        <button
          type="button"
          className={`${styles.btnIc} ${styles.danger}`}
          aria-label={`Delete ${server.name}`}
          aria-busy={busy && remove.isPending}
          title="Delete"
          disabled={actionPending}
          onClick={() => {
            if (window.confirm(`Delete server “${server.name}”? Its disk is erased. This can’t be undone.`)) {
              remove.mutate(server.id);
            }
          }}
        >
          {ICON_TRASH}
        </button>
      </div>
    );
  }

  return (
    <section className={styles.page}>
      {header}
      <ListGrid
        rail={
          <>
            <RailHero
              value={running}
              label="Running servers"
              caption="Servers, last 14 days"
              series={buildSeries(history)}
            />
            <RailSection title="Fleet" rows={fleetRows} />
            <RailSection title="This week" rows={[["Created", createdThisWeek], ["Deleted", deletedThisWeek]]} />
          </>
        }
      >
        {actionError && <p className={styles.error} role="alert">{actionError.message}</p>}
        <Panel>
          <div className={`${listClasses.headRow} ${styles.cols}`}>
            <div>Server</div>
            <div>Node</div>
            <div>macOS</div>
            <div>Software</div>
            <div>Created</div>
            <div>Status</div>
            <div />
          </div>
          <FixedList page={current} totalItems={items.length} onPage={setPage}>
            {items.length === 0 ? (
              <EmptyState title="No servers yet">
                A server is a Mac that keeps running — and keeps its disk — until you say otherwise.
              </EmptyState>
            ) : (
              slice.map((server) => {
                const status = serverStatus(server.status);
                return (
                  <div className={`${listClasses.row} ${styles.cols}`} key={server.id}>
                    <div className={listClasses.name}>{server.name}</div>
                    <div className={listClasses.cell}>{server.node_name}</div>
                    <div className={listClasses.cell}>{macosLabel(server.config)}</div>
                    <SoftwareCell config={server.config} />
                    <div className={listClasses.cell}>{createdAt(server.created_at)}</div>
                    <div>
                      <span className={styles.statusCell} title={server.status_detail ?? undefined}>
                        <StatusText tone={status.tone}>{status.label}</StatusText>
                        {(server.status === "provisioning" || server.status === "stopping" || busyId === server.id) && (
                          <Spinner />
                        )}
                      </span>
                    </div>
                    {rowActions(server)}
                  </div>
                );
              })
            )}
          </FixedList>
        </Panel>
      </ListGrid>
    </section>
  );
}
