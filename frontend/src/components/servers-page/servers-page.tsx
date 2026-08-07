import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { deleteServer, listServers, retryServer, startServer, stopServer } from "../../api";
import type { Server, ServerConfig } from "../../api";
import { OPENCLAW_CHANNELS, OS_RELEASES, SOFTWARE, XCODE_LOGO } from "../../image-catalog";
import { Button } from "../button/button";
import {
  EmptyState,
  FixedList,
  IconButton,
  ListGrid,
  Panel,
  RailHero,
  RailSection,
  Spinner,
  StatusText,
} from "../list-page/list-page";
import { buildSeries, listClasses, paginate, weeklyActivity } from "../list-page/list-page-data";
import { PageHeader } from "../page-header/page-header";
import styles from "./servers-page.module.css";

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
      const logo = SOFTWARE.find((item) => item.id === id)?.logo;
      if (logo) apps.push(<img key={id} src={logo} alt={name} title={name} />);
    }
  }
  if (apps.length === 0) return <div className={listClasses.cell}>Clean macOS</div>;
  const channels = OPENCLAW_CHANNELS.filter((channel) => config.channels.includes(channel.id) && channel.logo);
  return (
    <div className={styles.applogos}>
      {apps}
      {channels.length > 0 && <span className={styles.sep} />}
      {channels.map((channel) => (
        <img key={channel.id} src={channel.logo!} alt={channel.name} title={channel.name} />
      ))}
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
    // Begin polling before the API exposes its transient status.
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
      <section className={listClasses.page}>
        {header}
        <p className={styles.quiet}>Loading…</p>
      </section>
    );
  }
  if (servers.error) {
    return (
      <section className={listClasses.page}>
        {header}
        <p className={listClasses.error} role="alert">{servers.error.message}</p>
      </section>
    );
  }

  // Keep tombstones in activity data, but exclude them from the table.
  const history = servers.data;
  const items = servers.data
    .filter((server) => server.deleted_at == null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const { current, items: slice } = paginate(items, page);

  const running = items.filter((server) => server.status === "running").length;
  const stopped = items.filter((server) => server.status === "stopped").length;
  const provisioning = items.filter((server) => server.status === "provisioning").length;
  const nodesInUse = new Set(items.map((server) => server.node_id)).size;
  const activity = weeklyActivity(history, servers.dataUpdatedAt);
  const fleetRows: Array<[string, number]> = [["Running", running]];
  if (provisioning > 0) fleetRows.push(["Provisioning", provisioning]);
  fleetRows.push(["Stopped", stopped], ["Total", items.length], ["Nodes in use", nodesInUse]);

  function rowActions(server: Server) {
    const busy = busyId === server.id;
    return (
      <div className={styles.acts}>
        {server.status === "failed" && (
          <IconButton
            icon={RotateCcw}
            label={`Retry ${server.name}`}
            loading={busy && retry.isPending}
            title="Retry provisioning"
            disabled={actionPending}
            onClick={() => retry.mutate(server.id)}
          />
        )}
        {server.status === "running" ? (
          <IconButton
            icon={Square}
            filled
            label={`Stop ${server.name}`}
            loading={busy && stop.isPending}
            title="Stop"
            disabled={actionPending}
            onClick={() => stop.mutate(server.id)}
          />
        ) : (
          <IconButton
            icon={Play}
            filled
            label={`Start ${server.name}`}
            loading={busy && start.isPending}
            title="Start"
            disabled={actionPending || server.status !== "stopped"}
            onClick={() => start.mutate(server.id)}
          />
        )}
        <IconButton
          icon={Trash2}
          danger
          label={`Delete ${server.name}`}
          loading={busy && remove.isPending}
          title="Delete"
          disabled={actionPending}
          onClick={() => {
            if (window.confirm(`Delete server “${server.name}”? Its disk is erased. This can’t be undone.`)) {
              remove.mutate(server.id);
            }
          }}
        />
      </div>
    );
  }

  return (
    <section className={listClasses.page}>
      {header}
      <ListGrid
        rail={
          <>
            <RailHero
              value={running}
              label="Running servers"
              caption="Servers, last 14 days"
              series={buildSeries(history, servers.dataUpdatedAt)}
            />
            <RailSection title="Fleet" rows={fleetRows} />
            <RailSection title="This week" rows={[["Created", activity.created], ["Deleted", activity.deleted]]} />
          </>
        }
      >
        {actionError && <p className={listClasses.error} role="alert">{actionError.message}</p>}
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
                    <div className={listClasses.name}><Link className={styles.resourceLink} to={`/servers/${server.id}`}>{server.name}</Link></div>
                    <div className={listClasses.cell}>{server.node_name}</div>
                    <div className={listClasses.cell}>{macosLabel(server.config)}</div>
                    <SoftwareCell config={server.config} />
                    <div className={listClasses.cell}>{createdAt(server.created_at)}</div>
                    <div>
                      <span className={listClasses.statusCell}>
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
