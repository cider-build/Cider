import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { deleteNode, listNodes } from "../../api";
import { PageHeader } from "../page-header/page-header";
import { RegisterNode } from "../register-node/register-node";
import { TextInput } from "../text-input/text-input";
import styles from "./nodes-page.module.css";

export function NodesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const nodes = useQuery({
    queryKey: ["nodes", page, search],
    queryFn: () => listNodes({ page, search }),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: deleteNode,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  const data = nodes.data;

  return (
    <section className={styles.page}>
      <PageHeader title="Nodes" />
      <div className={styles.actions}>
        {data && (data.total > 0 || search !== "") && <RegisterNode text="Add new node" />}
      </div>
      {nodes.status === "pending" ? (
        "Loading..."
      ) : nodes.error ? (
        <p className={styles.error}>{nodes.error.message}</p>
      ) : data && data.total === 0 && search === "" ? (
        <div className={styles.empty}>
          <RegisterNode text="Add a node" />
        </div>
      ) : data ? (
        <div className={styles.container} data-fetching={nodes.isFetching}>
          <div className={styles.containerHeader}>
            <TextInput styleType={TextInput.Style.BottomBorder} value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search" />
            <div className={styles.pagination}>
              <button aria-label="Previous page" disabled={data.page === 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft size={22} strokeWidth={3} />
              </button>
              <span>{data.page} of {data.pages}</span>
              <button aria-label="Next page" disabled={data.page === data.pages || nodes.isPlaceholderData} onClick={() => setPage(page + 1)}>
                <ChevronRight size={22} strokeWidth={3} />
              </button>
            </div>
          </div>
          <div className={styles.list}>
            {data.items.map((node) => (
              <article className={styles.item} key={node.id}>
                <div>
                  <strong>{node.name}</strong>
                  <span>{node.url}</span>
                </div>
                <button onClick={() => remove.mutate(node.id)} disabled={remove.isPending}>×</button>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
