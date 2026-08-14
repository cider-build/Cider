import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { listNodes } from "../../api";
import { Id, StatusText } from "../ui";
import {
  DataTable,
  PageHead,
  Pager,
  Row,
  SearchField,
  Toolbar,
} from "../list";
import { memory } from "./nodes-page.utils";

const PER_PAGE = 15;

export function NodesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const nodes = useQuery({
    queryKey: ["nodes", page, query],
    queryFn: () => listNodes({ page: page + 1, search: query }),
    placeholderData: keepPreviousData,
  });

  const items = nodes.data?.items ?? [];
  const total = nodes.data?.total ?? 0;
  const pages = Math.max(1, nodes.data?.pages ?? 1);

  return (
    <section>
      <PageHead title="Nodes" />
      <Toolbar>
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder="Search nodes"
        />
      </Toolbar>
      <DataTable
        head={["ID", "Name", "Chip", "CPU", "Memory", "Connection"]}
        rows={PER_PAGE}
        error={nodes.error === null ? null : (nodes.error).message}
        empty={
          nodes.status === "pending"
            ? "Loading nodes"
            : "No Macs connected yet."
        }
      >
        {items.map((node) => (
          <Row
            key={node.id}
            onOpen={() => {
              void navigate(`/nodes/${node.id}`);
            }}
          >
            <td>
              <Id value={node.id} />
            </td>
            <td>
              <b>{node.name}</b>
            </td>
            <td>{node.metadata?.chip ?? "—"}</td>
            <td>{node.metadata?.cpu_count ?? "—"}</td>
            <td>{memory(node.metadata)}</td>
            <td>
              <StatusText label={node.connected ? "Connected" : "Offline"} />
            </td>
          </Row>
        ))}
      </DataTable>
      <Pager
        page={page}
        pages={pages}
        total={total}
        shown={PER_PAGE}
        onPage={setPage}
      />
    </section>
  );
}
