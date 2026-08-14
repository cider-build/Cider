import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  useSearchedPage,
} from "../list";
import { bytes, created, sandboxName } from "../ui/names";

const PER_PAGE = 15;

export function SnapshotsPage() {
  const queryClient = useQueryClient();
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
  const error = [restore.error, remove.error, snapshots.error].find(Boolean);

  const all = (snapshots.data ?? []).filter(
    (snapshot) => snapshot.deleted_at === null,
  );
  const list = useSearchedPage(
    all,
    (snapshot, needle) =>
      `${snapshot.id} ${snapshot.source_sandbox_id}`
        .toLowerCase()
        .includes(needle),
    PER_PAGE,
  );

  return (
    <section>
      <PageHead title="Snapshots" />
      <Toolbar>
        <SearchField
          value={list.query}
          onChange={list.setQuery}
          placeholder="Search snapshots"
        />
      </Toolbar>
      <DataTable
        head={["ID", "Source sandbox", "Size", "Created", ""]}
        rows={PER_PAGE}
        error={error?.message}
        empty={
          snapshots.status === "pending"
            ? "Loading snapshots"
            : "No snapshots yet. A snapshot is taken from a sandbox."
        }
      >
        {list.slice.map((snapshot) => (
          <Row key={snapshot.id}>
            <td>
              <Id value={snapshot.id} />
            </td>
            <td>
              <b>
                <Id value={sandboxName(snapshot.source_sandbox_id)} wide />
              </b>
            </td>
            <td>{bytes(snapshot.size_bytes)}</td>
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
        page={list.page}
        pages={list.pages}
        total={list.total}
        shown={PER_PAGE}
        onPage={list.setPage}
      />
    </section>
  );
}
