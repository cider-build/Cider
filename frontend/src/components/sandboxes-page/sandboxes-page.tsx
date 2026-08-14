import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteSandbox,
  listSandboxes,
  pauseSandbox,
  resumeSandbox,
} from "../../api";
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
} from "../list";
import {
  isTransitional,
  pollWhileTransitional,
  sandboxName,
} from "../ui/names";
import type { Sandbox } from "../../api";
import {
  created,
  label,
  useSandboxAction,
} from "./sandboxes-page.utils";

const PER_PAGE = 15;
const STATUSES = ["All", "Active", "Paused", "Stopped"];

export function SandboxesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(0);
  const sandboxes = useQuery({
    queryKey: ["sandboxes"],
    queryFn: listSandboxes,
    refetchInterval: (query) => pollWhileTransitional(query.state.data),
  });
  const pause = useSandboxAction(pauseSandbox);
  const resume = useSandboxAction(resumeSandbox);
  const remove = useSandboxAction(deleteSandbox);
  const pending = pause.isPending || resume.isPending || remove.isPending;
  const error
    = [pause.error, resume.error, remove.error, sandboxes.error].find(Boolean)
      ?? null;

  const all = (sandboxes.data ?? []).filter(
    (sandbox) => sandbox.deleted_at === null,
  );
  const needle = query.trim().toLowerCase();
  const matches = all.filter((sandbox) => {
    const haystack
      = `${sandboxName(sandbox.id)} ${sandbox.node_name}`.toLowerCase();
    return (
      haystack.includes(needle)
      && (status === "All" || label(sandbox.status) === status)
    );
  });
  const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = matches.slice(current * PER_PAGE, (current + 1) * PER_PAGE);

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
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder="Search sandboxes"
        />
        <StatusFilter
          options={STATUSES}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        />
      </Toolbar>
      <DataTable
        head={["Sandbox", "Node", "Created", "State", ""]}
        rows={PER_PAGE}
        error={error === null ? null : (error).message}
        empty={
          sandboxes.status === "pending"
            ? "Loading sandboxes"
            : "No sandboxes yet. Run cider open in a project and one appears here."
        }
      >
        {slice.map((sandbox) => (
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
        page={current}
        pages={pages}
        total={matches.length}
        shown={PER_PAGE}
        onPage={setPage}
      />
    </section>
  );
}
