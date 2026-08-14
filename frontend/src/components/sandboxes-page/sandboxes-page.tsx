import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteSandbox,
  listSandboxes,
  pauseSandbox,
  resumeSandbox,
} from "../../api";
import type { Sandbox } from "../../api";
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
  created,
  isTransitional,
  label,
  pollWhileTransitional,
  sandboxName,
} from "../ui/names";
import { useListAction } from "../ui/actions";

const PER_PAGE = 15;
const STATUSES = ["All", "Active", "Paused", "Stopped"];

export function SandboxesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("All");
  const sandboxes = useQuery({
    queryKey: ["sandboxes"],
    queryFn: listSandboxes,
    refetchInterval: (query) => pollWhileTransitional(query.state.data),
  });
  const pause = useListAction<Sandbox>("sandboxes", pauseSandbox);
  const resume = useListAction<Sandbox>("sandboxes", resumeSandbox);
  const remove = useListAction<Sandbox>("sandboxes", deleteSandbox);
  const pending = pause.isPending || resume.isPending || remove.isPending;
  const error = [pause.error, resume.error, remove.error, sandboxes.error].find(
    Boolean,
  );

  const all = (sandboxes.data ?? []).filter(
    (sandbox) => sandbox.deleted_at === null,
  );
  const list = useSearchedPage(
    all,
    (sandbox, needle) =>
      `${sandboxName(sandbox.id)} ${sandbox.node_name}`
        .toLowerCase()
        .includes(needle)
        && (status === "All" || label(sandbox.status) === status),
    PER_PAGE,
  );

  function rowActions(sandbox: Sandbox) {
    const working = (mutation: { isPending: boolean; variables?: string }) =>
      mutation.isPending && mutation.variables === sandbox.id;
    const moving = isTransitional(sandbox.status);
    return (
      <RowActions>
        {sandbox.status === "paused"
          ? (
              <Button
                disabled={pending || moving}
                loading={working(resume)}
                onClick={() => resume.mutate(sandbox.id)}
              >
                Resume
              </Button>
            )
          : (
              <Button
                disabled={pending || moving || sandbox.status !== "active"}
                loading={working(pause)}
                onClick={() => pause.mutate(sandbox.id)}
              >
                Pause
              </Button>
            )}
        <Button
          disabled={pending}
          loading={working(remove)}
          onClick={() => {
            if (
              window.confirm(
                "Delete this sandbox? Its volume is erased and this cannot be undone.",
              )
            )
              remove.mutate(sandbox.id);
          }}
        >
          Delete
        </Button>
      </RowActions>
    );
  }

  return (
    <section>
      <PageHead title="Sandboxes" />
      <Toolbar>
        <SearchField
          value={list.query}
          onChange={list.setQuery}
          placeholder="Search sandboxes"
        />
        <StatusFilter
          options={STATUSES}
          value={status}
          onChange={(value) => {
            setStatus(value);
            list.setPage(0);
          }}
        />
      </Toolbar>
      <DataTable
        head={["Sandbox", "Node", "Created", "State", ""]}
        rows={PER_PAGE}
        error={error?.message}
        empty={
          sandboxes.status === "pending"
            ? "Loading sandboxes"
            : "No sandboxes yet. Run cider open in a project and one appears here."
        }
      >
        {list.slice.map((sandbox) => (
          <Row
            key={sandbox.id}
            onOpen={() => {
              void navigate(`/sandboxes/${sandbox.id}`);
            }}
          >
            <td>
              <b>
                <Id value={sandboxName(sandbox.id)} wide />
              </b>
            </td>
            <td>{sandbox.node_name}</td>
            <td>{created(sandbox.created_at)}</td>
            <td>
              <StatusText label={label(sandbox.status)} />
            </td>
            <td>{rowActions(sandbox)}</td>
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
