import { useQuery } from "@tanstack/react-query";
import { listSandboxes } from "../../api";
import type { Sandbox } from "../../api";
import { PageHeader } from "../page-header/page-header";
import styles from "./sandboxes-page.module.css";

function createdAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SandboxRow({ sandbox }: { sandbox: Sandbox }) {
  return (
    <article className={styles.row}>
      <strong>{sandbox.id}</strong>
      <span>{sandbox.node_name}</span>
      <span>{sandbox.deleted_at ? "Deleted" : "Active"}</span>
      <time>{createdAt(sandbox.created_at)}</time>
    </article>
  );
}

export function SandboxesPage() {
  const sandboxes = useQuery({ queryKey: ["sandboxes"], queryFn: listSandboxes });

  if (sandboxes.status === "pending") return "Loading...";
  if (sandboxes.error) return <p className={styles.error}>{sandboxes.error.message}</p>;

  return (
    <section className={styles.page}>
      <PageHeader title="Sandboxes" />
      <div className={styles.container}>
        <div className={styles.tableHeader}>
          <span>Sandbox</span>
          <span>Node</span>
          <span>Status</span>
          <span>Created</span>
        </div>
        <div className={styles.rows}>
          {sandboxes.data.map((sandbox) => <SandboxRow key={sandbox.id} sandbox={sandbox} />)}
        </div>
      </div>
    </section>
  );
}
