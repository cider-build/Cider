import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { deleteSandbox, listAllNodes, listSandboxes, pauseSandbox, resumeSandbox } from "../../api";
import type { Sandbox } from "../../api";
import {
  EmptyState,
  FixedList,
  IconButton,
  ListGrid,
  ListSearch,
  ListToolbar,
  Panel,
  RailHero,
  RailSection,
  Spinner,
  StatusText,
} from "../list-page/list-page";
import { buildSeries, listClasses, paginate, weeklyActivity } from "../list-page/list-page-data";
import { PageHeader } from "../page-header/page-header";
import styles from "./sandboxes-page.module.css";

const COLUMNS = "minmax(150px, 1.4fr) minmax(84px, 104px) minmax(136px, 1fr) minmax(64px, 92px) minmax(96px, 108px) 78px";
const GIBIBYTE = 1024 ** 3;
const gbFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const STATUS_ORDER = ["active", "paused", "pausing", "provisioning", "restoring", "warm", "stopped", "deleted"];

function displayStatus(sandbox: Sandbox): string {
  return sandbox.deleted_at != null ? "deleted" : sandbox.status;
}

function statusTone(status: string): "ok" | "warm" | "gone" {
  if (status === "active" || status === "running") return "ok";
  if (status === "warm" || status === "paused" || status === "pausing" || status === "stopped") return "warm";
  if (status === "provisioning" || status === "restoring") return "warm";
  return "gone";
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCreated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${day}, ${hh}:${mm}`;
}

function StatusPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const label = value === "all" ? "All" : statusLabel(value);
  return (
    <div className={styles.sbStatus} ref={rootRef}>
      <button
        type="button"
        className={styles.statusTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className={styles.pre}>Status:</span> {label}
        </span>
        <span className={styles.caret} aria-hidden="true">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l4 4 4-4" />
          </svg>
        </span>
      </button>
      {open && (
        <div className={styles.statusMenu} role="listbox" aria-label="Filter by status">
          {["all", ...options].map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              className={styles.statusOpt}
              aria-selected={value === option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option === "all" ? "All" : statusLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SandboxesRail({ sandboxes, now }: { sandboxes: Sandbox[]; now: number }) {
  const active = sandboxes.filter(
    (sandbox) => sandbox.deleted_at == null && sandbox.status === "active",
  ).length;

  const counts = new Map<string, number>();
  for (const sandbox of sandboxes) {
    const status = displayStatus(sandbox);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const fleetRows: Array<[string, number]> = [...counts.keys()]
    .sort(sortByStatusOrder)
    .map((status) => [statusLabel(status), counts.get(status) ?? 0]);
  fleetRows.push(["Total", sandboxes.length]);

  const activity = weeklyActivity(sandboxes, now);

  return (
    <>
      <RailHero
        value={active}
        label="Active sandboxes"
        caption="Sandboxes, last 14 days"
        series={buildSeries(sandboxes, now)}
      />
      <RailSection title="Fleet" rows={fleetRows} />
      <RailSection
        title="This week"
        rows={[
          ["Created", activity.created],
          ["Deleted", activity.deleted],
        ]}
      />
    </>
  );
}

function sortByStatusOrder(a: string, b: string): number {
  const ia = STATUS_ORDER.indexOf(a);
  const ib = STATUS_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export function SandboxesPage() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sandboxes"] });
  const remove = useMutation({ mutationFn: deleteSandbox, onSuccess: refresh });
  const pause = useMutation({ mutationFn: pauseSandbox, onSuccess: refresh });
  const resume = useMutation({ mutationFn: resumeSandbox, onSuccess: refresh });
  const actionError = pause.error ?? resume.error ?? remove.error;
  const actionPending = pause.isPending || resume.isPending || remove.isPending;
  const sandboxes = useQuery({
    queryKey: ["sandboxes"],
    queryFn: listSandboxes,
    // Begin polling before the API exposes its transient status.
    refetchInterval: (query) =>
      actionPending ||
      query.state.data?.some(
        (sandbox) => sandbox.deleted_at == null && ["pausing", "restoring", "provisioning"].includes(sandbox.status),
      )
        ? 2000
        : false,
  });
  const nodes = useQuery({ queryKey: ["nodes", "all-pages"], queryFn: listAllNodes });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);

  const data = sandboxes.data;

  const nodeById = useMemo(
    () => new Map((nodes.data ?? []).map((node) => [node.id, node])),
    [nodes.data],
  );

  const statusOptions = useMemo(
    () => [...new Set((data ?? []).map(displayStatus))].sort(sortByStatusOrder),
    [data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (sandbox) =>
        (status === "all" || displayStatus(sandbox) === status) &&
        (q === "" || `${sandbox.id} ${sandbox.node_name}`.toLowerCase().includes(q)),
    );
  }, [data, query, status]);

  const { current: currentPage, items: pageItems } = paginate(filtered, page);

  function allocation(sandbox: Sandbox): string {
    const configuration = nodeById.get(sandbox.node_id)?.configuration;
    if (!configuration) return "—";
    const memory = gbFormat.format(configuration.sandbox_memory_bytes / GIBIBYTE);
    const storage = gbFormat.format(configuration.sandbox_storage_bytes / GIBIBYTE);
    return `${configuration.sandbox_cpu_count} CPU, ${memory} GB, ${storage} GB`;
  }

  return (
    <div className={listClasses.page}>
      <PageHeader
        title="Sandboxes"
        lede={
          <>
            Disposable Macs, created from the CLI — run <span className={styles.kbd}>cider open .</span> in
            a project and one appears here. Pause a sandbox to free its slot; resume picks up where it
            left off, on any node.
          </>
        }
      />
      <ListGrid rail={data ? <SandboxesRail sandboxes={data} now={sandboxes.dataUpdatedAt} /> : null}>
        {actionError && <p className={styles.actionError} role="alert">{actionError.message}</p>}
        {sandboxes.status === "pending" ? (
          <Panel>
            <p className={styles.quiet}>Loading sandboxes</p>
          </Panel>
        ) : sandboxes.error ? (
          <Panel>
            <p className={styles.quiet}>{sandboxes.error.message || "Could not load sandboxes."}</p>
          </Panel>
        ) : data ? (
          <Panel>
            <ListToolbar>
              <ListSearch
                placeholder="Search by sandbox id or node"
                aria-label="Search sandboxes"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              <StatusPicker
                value={status}
                options={statusOptions}
                onChange={(next) => {
                  setStatus(next);
                  setPage(0);
                }}
              />
            </ListToolbar>
            <div className={listClasses.headRow} style={{ gridTemplateColumns: COLUMNS }}>
              <div>Sandbox</div>
              <div>Node</div>
              <div>
                <span className={styles.thHelp}>
                  Allocation
                  <i className={styles.hintI} aria-hidden="true">i</i>
                  <span className={styles.tip} role="tooltip">
                    CPU cores, memory (GB), storage (GB) given to this sandbox.
                  </span>
                </span>
              </div>
              <div>Status</div>
              <div>Created</div>
              <div />
            </div>
            <FixedList page={currentPage} totalItems={filtered.length} onPage={setPage}>
              {pageItems.length === 0 ? (
                data.length === 0 ? (
                  <EmptyState title="No sandboxes yet">
                    Run <span className={styles.kbd}>cider open .</span> in a project to create one.
                  </EmptyState>
                ) : (
                  <EmptyState title="No sandboxes match">
                    Try a different search or status filter.
                  </EmptyState>
                )
              ) : (
                pageItems.map((sandbox) => {
                  const state = displayStatus(sandbox);
                  return (
                    <div
                      className={`${listClasses.row} ${styles.linkRow}`}
                      style={{ gridTemplateColumns: COLUMNS }}
                      key={sandbox.id}
                    >
                      <div className={`${listClasses.name} ${listClasses.mono}`}>
                        <Link className={styles.resourceLink} to={`/sandboxes/${sandbox.id}`}>{sandbox.id}</Link>
                      </div>
                      <div className={listClasses.cell}>{sandbox.node_name}</div>
                      <div className={listClasses.cell}>{allocation(sandbox)}</div>
                      <div className={listClasses.statusCell}>
                        <StatusText tone={statusTone(state)}>{statusLabel(state)}</StatusText>
                        {(["pausing", "restoring", "provisioning"].includes(state) ||
                          (actionPending &&
                            (pause.variables === sandbox.id ||
                              resume.variables === sandbox.id ||
                              remove.variables === sandbox.id))) && <Spinner />}
                      </div>
                      <div className={listClasses.cell}>{formatCreated(sandbox.created_at)}</div>
                      <div className={styles.acts}>
                        {state === "active" && (
                          <IconButton
                            icon={Pause}
                            filled
                            label={`Pause sandbox ${sandbox.id}`}
                            loading={pause.isPending && pause.variables === sandbox.id}
                            title="Pause"
                            disabled={actionPending}
                            onClick={() => pause.mutate(sandbox.id)}
                          />
                        )}
                        {state === "paused" && (
                          <IconButton
                            icon={Play}
                            filled
                            label={`Resume sandbox ${sandbox.id}`}
                            loading={resume.isPending && resume.variables === sandbox.id}
                            title="Resume"
                            disabled={actionPending}
                            onClick={() => resume.mutate(sandbox.id)}
                          />
                        )}
                        {sandbox.deleted_at == null && (
                          <IconButton
                            icon={Trash2}
                            danger
                            label={`Delete sandbox ${sandbox.id}`}
                            loading={remove.isPending && remove.variables === sandbox.id}
                            title="Delete"
                            disabled={actionPending}
                            onClick={() => {
                              if (window.confirm(`Delete sandbox ${sandbox.id}? Its VM and files are destroyed.`)) {
                                remove.mutate(sandbox.id);
                              }
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </FixedList>
          </Panel>
        ) : null}
      </ListGrid>
    </div>
  );
}
