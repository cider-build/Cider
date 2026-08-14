import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteServer,
  listServers,
  retryServer,
  startServer,
  stopServer,
} from "../../api";
import type { Server, ServerConfig } from "../../api";
import { OS_RELEASES } from "../../image-catalog";
import { Button, Id, StatusText } from "../ui/ui";
import {
  DataTable,
  PageHead,
  Pager,
  Row,
  RowActions,
  SearchField,
  StatusFilter,
  Toolbar,
} from "../ui/list";
import {
  isTransitional,
  pollAfterAction,
  pollWhileTransitional,
} from "../ui/names";
import styles from "./servers-page.module.css";

function useServerAction(
  fn: (id: string) => Promise<unknown>,
  onFired: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: onFired,
    mutationFn: fn,
    onSuccess: (updated) => {
      const server = updated as Server | undefined;
      if (server?.id === undefined) return;
      queryClient.setQueryData<Server[]>(["servers"], (current) =>
        current?.map((item) => (item.id === server.id ? server : item)),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

const PER_PAGE = 15;
const STATUSES = ["All", "Running", "Stopped", "Provisioning", "Failed"];

function created(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function macos(config: ServerConfig | null) {
  if (config === null) return "—";
  const release = OS_RELEASES.find((item) => item.id === config.image);
  return release ? `${release.version} ${release.name}` : config.image;
}

function label(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ServersPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(0);
  const [actedAt, setActedAt] = useState<number | null>(null);
  const fired = () => setActedAt(Date.now());
  const servers = useQuery({
    queryKey: ["servers"],
    queryFn: listServers,
    refetchInterval: (query) => {
      const moving = pollWhileTransitional(query.state.data);
      return moving === false ? pollAfterAction(actedAt) : moving;
    },
  });

  const start = useServerAction(startServer, fired);
  const stop = useServerAction(stopServer, fired);
  const retry = useServerAction(retryServer, fired);
  const remove = useServerAction(deleteServer, fired);
  const pending =
    start.isPending || stop.isPending || retry.isPending || remove.isPending;
  const error =
    [start.error, stop.error, retry.error, remove.error, servers.error].find(
      Boolean,
    ) ?? null;

  const all = (servers.data ?? []).filter(
    (server) => server.deleted_at === null,
  );
  const needle = query.trim().toLowerCase();
  const matches = all.filter((server) => {
    const haystack =
      `${server.name} ${server.node_name} ${macos(server.config)}`.toLowerCase();
    return (
      haystack.includes(needle) &&
      (status === "All" || label(server.status) === status)
    );
  });
  const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = matches.slice(current * PER_PAGE, (current + 1) * PER_PAGE);

  function rowActions(server: Server) {
    const working = (mutation: { isPending: boolean; variables?: string }) =>
      mutation.isPending && mutation.variables === server.id;
    const moving = isTransitional(server.status);
    return (
      <RowActions>
        {server.status === "failed" && (
          <Button
            disabled={pending}
            loading={working(retry)}
            onClick={() => retry.mutate(server.id)}
          >
            Retry
          </Button>
        )}
        {server.status === "running" ? (
          <Button
            disabled={pending || moving}
            loading={working(stop)}
            onClick={() => stop.mutate(server.id)}
          >
            Stop
          </Button>
        ) : (
          <Button
            disabled={pending || moving || server.status !== "stopped"}
            loading={working(start)}
            onClick={() => start.mutate(server.id)}
          >
            Start
          </Button>
        )}
        <Button
          disabled={pending}
          loading={working(remove)}
          onClick={() => {
            if (
              window.confirm(
                `Delete server \u201C${server.name}\u201D? Its disk is erased and this cannot be undone.`,
              )
            )
              remove.mutate(server.id);
          }}
        >
          Delete
        </Button>
      </RowActions>
    );
  }

  return (
    <section>
      <PageHead title="Servers" />
      <Toolbar>
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder="Search servers"
        />
        <StatusFilter
          options={STATUSES}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        />
        <Button kind="primary" onClick={() => navigate("/servers/new")}>
          Add server
        </Button>
      </Toolbar>
      <DataTable
        head={["ID", "Name", "Node", "macOS", "Created", "State", ""]}
        rows={PER_PAGE}
        error={error === null ? null : (error as Error).message}
        empty={
          servers.status === "pending"
            ? "Loading servers"
            : "No servers yet. A server is a Mac that keeps running, and keeps its disk, until you stop it."
        }
      >
        {slice.map((server) => (
          <Row key={server.id} onOpen={() => navigate(`/servers/${server.id}`)}>
            <td>
              <Id value={server.id} />
            </td>
            <td>
              <b>{server.name}</b>
            </td>
            <td>{server.node_name}</td>
            <td>{macos(server.config)}</td>
            <td>{created(server.created_at)}</td>
            <td title={server.status_detail ?? undefined}>
              <StatusText label={label(server.status)} />
              {server.status_detail != null && (
                <span className={styles.why} aria-label={server.status_detail}>
                  ?
                </span>
              )}
            </td>
            <td>{rowActions(server)}</td>
          </Row>
        ))}
      </DataTable>
      <Pager
        page={current}
        pages={pages}
        total={matches.length}
        shown={PER_PAGE}
        onPage={setPage}
      />
    </section>
  );
}
