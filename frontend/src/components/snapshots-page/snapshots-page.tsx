import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteSnapshot, listSnapshots } from "../../api";
import {
  EmptyState,
  FixedList,
  IconButton,
  ListGrid,
  Panel,
  RailHero,
  RailSection,
} from "../list-page/list-page";
import { buildSeries, listClasses, paginate, weeklyActivity } from "../list-page/list-page-data";
import { PageHeader } from "../page-header/page-header";
import styles from "./snapshots-page.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;

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

function relativeDate(value: string, now: number) {
  const days = Math.floor((now - new Date(value).getTime()) / DAY_MS);
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
      <section className={listClasses.page}>
        {header}
        <p className={styles.quiet}>Loading…</p>
      </section>
    );
  }
  if (snapshots.error) {
    return (
      <section className={listClasses.page}>
        {header}
        <p className={listClasses.error} role="alert">{snapshots.error.message}</p>
      </section>
    );
  }

  // Keep tombstones in activity data, but exclude them from the table.
  const history = snapshots.data;
  const items = snapshots.data
    .filter((snapshot) => snapshot.deleted_at == null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const { current, items: slice } = paginate(items, page);
  const newest = items[0] ?? null;
  const sized = items.filter((snapshot) => snapshot.size_bytes != null);
  const storedBytes = sized.length ? sized.reduce((sum, snapshot) => sum + (snapshot.size_bytes ?? 0), 0) : null;
  const largestBytes = sized.length ? Math.max(...sized.map((snapshot) => snapshot.size_bytes ?? 0)) : null;
  const activity = weeklyActivity(history, snapshots.dataUpdatedAt);

  return (
    <section className={listClasses.page}>
      {header}
      <ListGrid
        rail={
          <>
            <RailHero
              value={items.length}
              label="Snapshots"
              caption="Snapshots, last 14 days"
              series={buildSeries(history, snapshots.dataUpdatedAt)}
            />
            <RailSection
              title="Library"
              rows={[
                ["Snapshots", items.length],
                ["Stored", formatBytes(storedBytes)],
                ["Largest", formatBytes(largestBytes)],
                ["Newest", newest ? relativeDate(newest.created_at, snapshots.dataUpdatedAt) : "—"],
              ]}
            />
            <RailSection title="This week" rows={[["Created", activity.created], ["Deleted", activity.deleted]]} />
          </>
        }
      >
        {remove.error && <p className={listClasses.error} role="alert">{remove.error.message}</p>}
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
                  <div className={`${listClasses.name} ${listClasses.mono}`}>{snapshot.id}</div>
                  <div className={`${listClasses.cell} ${listClasses.mono}`}>{snapshot.source_sandbox_id}</div>
                  <div className={`${listClasses.cell} ${listClasses.num}`}>{formatBytes(snapshot.size_bytes)}</div>
                  <div className={listClasses.cell}>{createdAt(snapshot.created_at)}</div>
                  <div className={styles.acts}>
                    <IconButton
                      icon={Trash2}
                      danger
                      label={`Delete snapshot ${snapshot.id}`}
                      loading={remove.isPending && remove.variables === snapshot.id}
                      title="Delete"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete snapshot ${snapshot.id}? This can’t be undone.`)) {
                          remove.mutate(snapshot.id);
                        }
                      }}
                    />
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
