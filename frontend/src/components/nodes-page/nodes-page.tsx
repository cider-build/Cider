import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { listNodes } from "../../api";
import type { Node, NodeMetadata } from "../../api";
import {
  EmptyState,
  FixedList,
  ListGrid,
  listClasses,
  Panel,
  RailHero,
  RailSection,
  StatusText,
} from "../list-page/list-page";
import { PageHeader } from "../page-header/page-header";
import styles from "./nodes-page.module.css";

const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const GIBIBYTE = 1024 ** 3;
const TEBIBYTE = 1024 ** 4;

/** Bytes as "16 GB" / "1.5 TB" (binary units, L's labels). */
function formatBytes(bytes: number) {
  if (bytes / GIBIBYTE >= 1000) return `${amount.format(bytes / TEBIBYTE)} TB`;
  return `${amount.format(bytes / GIBIBYTE)} GB`;
}

/** The rail needs fleet-wide numbers; the list endpoint is paginated, so walk every page. */
async function listAllNodes(): Promise<Node[]> {
  const first = await listNodes({ page: 1, search: "" });
  const items = [...first.items];
  for (let page = 2; page <= first.pages; page += 1) {
    const next = await listNodes({ page, search: "" });
    items.push(...next.items);
  }
  return items;
}

const cellClass = listClasses.cell;
const numClass = `${listClasses.cell} ${listClasses.num}`;

function hardwareOf(nodes: Node[]): NodeMetadata[] {
  return nodes.flatMap((node) => (node.metadata ? [node.metadata] : []));
}

function NodesRail({ nodes }: { nodes: Node[] }) {
  const connected = nodes.filter((node) => node.connected);
  const hardware = hardwareOf(connected);
  const cpu = hardware.reduce((total, m) => total + m.cpu_count, 0);
  const memory = hardware.reduce((total, m) => total + m.memory_bytes, 0);
  const storage = hardware.reduce((total, m) => total + m.storage_total_bytes, 0);
  const free = hardware.reduce((total, m) => total + m.storage_available_bytes, 0);
  const slots = connected.reduce((total, node) => total + (node.configuration?.vm_count ?? 0), 0);
  return (
    <>
      {/* Nodes carry no created_at, so there is no honest 14-day series —
          the hero renders with an empty series (no sparkline) and no caption. */}
      <RailHero value={`${connected.length} of ${nodes.length}`} label="Macs connected" caption="" series={[]} />
      <RailSection
        title="Connected hardware"
        rows={[
          ["CPU cores", cpu],
          ["Memory", formatBytes(memory)],
          ["Storage", formatBytes(storage)],
        ]}
      />
      <RailSection
        title="Capacity"
        rows={[
          ["VM slots", slots],
          ["Disk free", `${formatBytes(free)} of ${formatBytes(storage)}`],
        ]}
      />
    </>
  );
}

function NodeRow({ node }: { node: Node }) {
  const meta = node.metadata;
  return (
    <Link className={`${listClasses.row} ${styles.colsNodes} ${styles.linkRow}`} to={`/nodes/${node.id}`}>
      <div className={listClasses.name}>{node.name}</div>
      <div className={cellClass}>{meta ? meta.chip : "—"}</div>
      <div className={cellClass}>{meta ? meta.macos_version : "—"}</div>
      <div className={numClass}>{meta ? meta.cpu_count : "—"}</div>
      <div className={numClass}>{meta ? formatBytes(meta.memory_bytes) : "—"}</div>
      <div className={cellClass}>
        {meta ? `${formatBytes(meta.storage_available_bytes)} free of ${formatBytes(meta.storage_total_bytes)}` : "—"}
      </div>
      <div>
        {node.connected
          ? <StatusText tone="ok">Connected</StatusText>
          : <StatusText tone="gone">Offline</StatusText>}
      </div>
      <div className={styles.chev} aria-hidden="true">›</div>
    </Link>
  );
}

export function NodesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const nodes = useQuery({
    queryKey: ["nodes", page, search],
    queryFn: () => listNodes({ page, search }),
    placeholderData: keepPreviousData,
  });
  const fleet = useQuery({ queryKey: ["nodes", "fleet"], queryFn: listAllNodes });

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  const data = nodes.data;

  return (
    <section>
      <PageHeader
        title="Nodes"
        lede={
          <>
            The Macs behind your account. Connect any Apple Silicon machine with{" "}
            <span className={styles.kbd}>cider connect</span> and Cider runs VMs on it.
          </>
        }
      />
      {nodes.status === "pending" ? (
        "Loading..."
      ) : nodes.error ? (
        <p className={styles.error}>{nodes.error.message}</p>
      ) : data ? (
        <ListGrid rail={fleet.data ? <NodesRail nodes={fleet.data} /> : null}>
          <div className={styles.fade} data-fetching={nodes.isFetching}>
            <Panel>
              <div className={styles.toolbar}>
                <input
                  className={styles.search}
                  type="text"
                  value={search}
                  onChange={(event) => updateSearch(event.target.value)}
                  placeholder="Search by node name"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search nodes"
                />
              </div>
              <div className={`${listClasses.headRow} ${styles.colsNodes}`}>
                <div>Node</div>
                <div>Chip</div>
                <div>macOS</div>
                <div className={listClasses.num}>CPU</div>
                <div className={listClasses.num}>Memory</div>
                <div>Disk</div>
                <div>Status</div>
                <div />
              </div>
              <FixedList page={data.page - 1} totalItems={data.total} onPage={(index) => setPage(index + 1)}>
                {data.items.length === 0 ? (
                  search === "" ? (
                    <EmptyState title="No nodes connected">
                      Connect any Apple Silicon Mac with <span className={styles.kbd}>cider connect</span>.
                    </EmptyState>
                  ) : (
                    <EmptyState title="No nodes match">Try a different search.</EmptyState>
                  )
                ) : (
                  data.items.map((node) => <NodeRow key={node.id} node={node} />)
                )}
              </FixedList>
            </Panel>
          </div>
        </ListGrid>
      ) : null}
    </section>
  );
}
