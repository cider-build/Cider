import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { createNode, deleteNode, listNodes } from "../../api";
import styles from "./nodes-page.module.css";

export function NodesPage() {
  const queryClient = useQueryClient();
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: listNodes });
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const create = useMutation({
    mutationFn: createNode,
    onSuccess: async () => {
      setName("");
      setUrl("");
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const remove = useMutation({
    mutationFn: deleteNode,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({ name, url });
  }

  return (
    <section className={styles.page}>
      <h2>Nodes</h2>
      <form className={styles.form} onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL" />
        <button disabled={create.isPending}>Add node</button>
      </form>
      {create.error && <p className={styles.error}>{create.error.message}</p>}
      {nodes.status === "pending" ? (
        "Loading..."
      ) : nodes.error ? (
        <p className={styles.error}>{nodes.error.message}</p>
      ) : (
        <div className={styles.list}>
          {nodes.data.map((node) => (
            <article className={styles.item} key={node.id}>
              <strong>{node.name}</strong>
              <span>{node.url}</span>
              <button onClick={() => remove.mutate(node.id)} disabled={remove.isPending}>Remove</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
