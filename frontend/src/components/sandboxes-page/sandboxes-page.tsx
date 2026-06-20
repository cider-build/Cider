import { useQuery } from "@tanstack/react-query";
import { listSandboxes } from "../../api";
import type { Sandbox } from "../../api";
import styles from "./sandboxes-page.module.css";

function SandboxList({ title, sandboxes }: { title: string; sandboxes: Sandbox[] }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      <div className={styles.list}>
        {sandboxes.map((sandbox) => (
          <article className={styles.item} key={sandbox.id}>
            <strong>{sandbox.id}</strong>
            <span>{sandbox.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SandboxesPage() {
  const sandboxes = useQuery({ queryKey: ["sandboxes"], queryFn: listSandboxes });

  if (sandboxes.status === "pending") return "Loading...";
  if (sandboxes.error) return <p className={styles.error}>{sandboxes.error.message}</p>;

  const active = sandboxes.data.filter((sandbox) => sandbox.deleted_at === null);
  const previous = sandboxes.data.filter((sandbox) => sandbox.deleted_at !== null);

  return (
    <section className={styles.page}>
      <h2>Sandboxes</h2>
      <SandboxList title="Active" sandboxes={active} />
      <SandboxList title="Previous" sandboxes={previous} />
    </section>
  );
}
