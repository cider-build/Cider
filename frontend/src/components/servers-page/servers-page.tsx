import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteServer,
  listServers,
  retryServer,
  startServer,
  stopServer,
} from "../../api";
import type { Server } from "../../api";
import { macos } from "../../image-catalog";
import { Button, Id, StatusText } from "../ui";
import {
  DataTable,
  PageHead,
  Pager,
  Row,
  RowActions,
  SearchField,
  StatusFilter,
  Toolbar,
  useSearchedPage,
} from "../list";
import {
  isTransitional,
  label,
  pollAfterAction,
  pollWhileTransitional,
} from "../ui/names";
import { useListAction } from "../ui/actions";
import { createdDate } from "./servers-page.utils";
import styles from "./servers-page.module.css";

const PER_PAGE = 15;
const STATUSES = ["All", "Running", "Stopped", "Provisioning", "Failed"];

export function ServersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("All");
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

  const start = useListAction<Server>("servers", startServer, fired);
  const stop = useListAction<Server>("servers", stopServer, fired);
  const retry = useListAction<Server>("servers", retryServer, fired);
  const remove = useListAction<Server>("servers", deleteServer, fired);
  const pending
    = start.isPending || stop.isPending || retry.isPending || remove.isPending;
  const error
    = [start.error, stop.error, retry.error, remove.error, servers.error].find(
      Boolean,
    );

  const all = (servers.data ?? []).filter(
    (server) => server.deleted_at === null,
  );
  const list = useSearchedPage(
    all,
    (server, needle) =>
      `${server.name} ${server.node_name} ${macos(server.config?.image)}`
        .toLowerCase()
        .includes(needle)
        && (status === "All" || label(server.status) === status),
    PER_PAGE,
  );

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
        {server.status === "running"
          ? (
              <Button
                disabled={pending || moving}
                loading={working(stop)}
                onClick={() => stop.mutate(server.id)}
              >
                Stop
              </Button>
            )
          : (
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
                `Delete server “${server.name}”? Its disk is erased and this cannot be undone.`,
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
          value={list.query}
          onChange={list.setQuery}
          placeholder="Search servers"
        />
        <StatusFilter
          options={STATUSES}
          value={status}
          onChange={(value) => {
            setStatus(value);
            list.setPage(0);
          }}
        />
        <Button
          kind="primary"
          onClick={() => {
            void navigate("/servers/new");
          }}
        >
          Add server
        </Button>
      </Toolbar>
      <DataTable
        head={["ID", "Name", "Node", "macOS", "Created", "State", ""]}
        rows={PER_PAGE}
        error={error?.message}
        empty={
          servers.status === "pending"
            ? "Loading servers"
            : "No servers yet. A server is a Mac that keeps running, and keeps its disk, until you stop it."
        }
      >
        {list.slice.map((server) => (
          <Row
            key={server.id}
            onOpen={() => {
              void navigate(`/servers/${server.id}`);
            }}
          >
            <td>
              <Id value={server.id} />
            </td>
            <td>
              <b>{server.name}</b>
            </td>
            <td>{server.node_name}</td>
            <td>{macos(server.config?.image)}</td>
            <td>{createdDate(server.created_at)}</td>
            <td title={server.status_detail ?? undefined}>
              <StatusText label={label(server.status)} />
              {server.status_detail != null && (
                <span className={styles.why}>?</span>
              )}
            </td>
            <td>{rowActions(server)}</td>
          </Row>
        ))}
      </DataTable>
      <Pager
        page={list.page}
        pages={list.pages}
        total={list.total}
        shown={PER_PAGE}
        onPage={list.setPage}
      />
    </section>
  );
}
