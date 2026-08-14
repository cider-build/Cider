import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteSnapshot, listSnapshots, restoreSnapshot } from "../../api";
import { Button, Id } from "../ui";
import {
  DataTable,
  PageHead,
  Pager,
  Row,
  RowActions,
  SearchField,
  Toolbar,
} from "../list";
import { sandboxName } from "../ui/names";
import { created, size } from "./snapshots-page.utils";

const PER_PAGE = 15;

export function SnapshotsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const snapshots = useQuery({
    queryKey: ["snapshots"],
    queryFn: listSnapshots,
  });
  const settle = {
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      await queryClient.invalidateQueries({ queryKey: ["sandboxes"] });
    },
  };
  const restore = useMutation({ mutationFn: restoreSnapshot, ...settle });
  const remove = useMutation({ mutationFn: deleteSnapshot, ...settle });
  const pending = restore.isPending || remove.isPending;
  const error
    = [restore.error, remove.error, snapshots.error].find(Boolean) ?? null;

  const all = (snapshots.data ?? []).filter(
    (snapshot) => snapshot.deleted_at === null,
  );
  const needle = query.trim().toLowerCase();
  const matches = all.filter((snapshot) =>
    `${snapshot.id} ${snapshot.source_sandbox_id}`
      .toLowerCase()
      .includes(needle),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = matches.slice(current * PER_PAGE, (current + 1) * PER_PAGE);

  return (
    <section>
      <PageHead title="Snapshots" />
      <Toolbar>
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder="Search snapshots"
        />
      </Toolbar>
      <DataTable
        head={["ID", "Source sandbox", "Size", "Created", ""]}
        rows={PER_PAGE}
        error={error === null ? null : (error).message}
        empty={
          snapshots.status === "pending"
            ? "Loading snapshots"
            : "No snapshots yet. A snapshot is taken from a sandbox."
        }
      >
        {slice.map((snapshot) => (
          <Row key={snapshot.id}>
            <td>
              <Id value={snapshot.id} />
            </td>
            <td>
              <b>
                <Id value={sandboxName(snapshot.source_sandbox_id)} wide />
              </b>
            </td>
            <td>{size(snapshot.size_bytes)}</td>
            <td>{created(snapshot.created_at)}</td>
            <td>
              <RowActions>
                <Button
                  disabled={pending}
                  loading={
                    restore.isPending && restore.variables === snapshot.id
                  }
                  onClick={() => restore.mutate(snapshot.id)}
                >
                  Restore
                </Button>
                <Button
                  disabled={pending}
                  loading={remove.isPending && remove.variables === snapshot.id}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this snapshot? This cannot be undone.",
                      )
                    )
                      remove.mutate(snapshot.id);
                  }}
                >
                  Delete
                </Button>
              </RowActions>
            </td>
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
