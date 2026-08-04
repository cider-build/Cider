import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteSnapshot, listSnapshots } from "../../api";
import {
  buildSeries,
  EmptyState,
  FixedList,
  ListGrid,
  listClasses,
  Panel,
  RailHero,
  RailSection,
} from "../list-page/list-page";
import { PageHeader } from "../page-header/page-header";
import styles from "./snapshots-page.module.css";

const PER_PAGE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const ICON_TRASH = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

function formatBytes(size: number | null): string {
  if (size == null) return "\u2014";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function createdAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function SnapshotsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const snapshots = useQuery({ queryKey: ["snapshots"], queryFn: listSnapshots });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["snapshots"] });
    await queryClient.invalidateQueries({ queryKey: ["sandboxes"] });
  };
  const remove = useMutation({ mutationFn: deleteSnapshot, onSuccess: refresh });

  const header = (
    <PageHeader
      title="Snapshots"
      lede="Point-in-time copies of a VM’s disk, portable across nodes."
    />
  );

  if (snapshots.status === "pending") {
    return (
      <section className={styles.page}>
        {header}
        <p className={styles.quiet}>Loading…</p>
      </section>
    );
  }
  if (snapshots.error) {
    return (
      <section className={styles.page}>
        {header}
        <p className={styles.error} role="alert">{snapshots.error.message}</p>
      </section>
    );
  }

  // The response includes tombstones for the sparkline; the table shows live rows.
  const history = snapshots.data;
  const items = snapshots.data
    .filter((snapshot) => snapshot.deleted_at == null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(page, totalPages - 1);
  const slice = items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);
  const newest = items[0] ?? null;
  const sized = items.filter((snapshot) => snapshot.size_bytes != null);
  const storedBytes = sized.length ? sized.reduce((sum, snapshot) => sum + (snapshot.size_bytes ?? 0), 0) : null;
  const largestBytes = sized.length ? Math.max(...sized.map((snapshot) => snapshot.size_bytes ?? 0)) : null;
  const createdThisWeek = history.filter(
    (snapshot) => Date.now() - new Date(snapshot.created_at).getTime() < 7 * DAY_MS,
  ).length;
  const deletedThisWeek = history.filter(
    (snapshot) => snapshot.deleted_at != null && Date.now() - new Date(snapshot.deleted_at).getTime() < 7 * DAY_MS,
  ).length;

  return (
    <section className={styles.page}>
      {header}
      <ListGrid
        rail={
          <>
            <RailHero
              value={items.length}
              label="Snapshots"
              caption="Snapshots, last 14 days"
              series={buildSeries(history)}
            />
            <RailSection
              title="Library"
              rows={[
                ["Snapshots", items.length],
                ["Stored", formatBytes(storedBytes)],
                ["Largest", formatBytes(largestBytes)],
                ["Newest", newest ? relativeDate(newest.created_at) : "—"],
              ]}
            />
            <RailSection title="This week" rows={[["Created", createdThisWeek], ["Deleted", deletedThisWeek]]} />
          </>
        }
      >
        {remove.error && <p className={styles.error} role="alert">{remove.error.message}</p>}
        <Panel>
          <div className={`${listClasses.headRow} ${styles.cols}`}>
            <div>Snapshot</div>
            <div>Source sandbox</div>
            <div className={listClasses.num}>Size</div>
            <div>Created</div>
            <div />
          </div>
          <FixedList page={current} totalItems={items.length} onPage={setPage}>
            {items.length === 0 ? (
              <EmptyState title="No snapshots">
                Snapshot a sandbox or server to keep a portable copy of its disk.
              </EmptyState>
            ) : (
              slice.map((snapshot) => (
                <div className={`${listClasses.row} ${styles.cols}`} key={snapshot.id}>
                  <div className={`${listClasses.name} ${styles.mono}`}>{snapshot.id}</div>
                  <div className={`${listClasses.cell} ${styles.mono}`}>{snapshot.source_sandbox_id}</div>
                  <div className={`${listClasses.cell} ${listClasses.num}`}>{formatBytes(snapshot.size_bytes)}</div>
                  <div className={listClasses.cell}>{createdAt(snapshot.created_at)}</div>
                  <div className={styles.acts}>
                    <button
                      type="button"
                      className={`${styles.btnIc} ${styles.danger}`}
                      aria-label={`Delete snapshot ${snapshot.id}`}
                      aria-busy={remove.isPending && remove.variables === snapshot.id}
                      title="Delete"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete snapshot ${snapshot.id}? This can’t be undone.`)) {
                          remove.mutate(snapshot.id);
                        }
                      }}
                    >
                      {ICON_TRASH}
                    </button>
                  </div>
                </div>
              ))
            )}
          </FixedList>
        </Panel>
      </ListGrid>
    </section>
  );
}
