import type { ReactNode } from "react";
import { LinkOut } from "../ui";
import styles from "./detail-head.module.css";

export function DetailHead({
  title,
  id,
  parent,
  actions,
}: {
  title: string;
  id?: string;
  parent?: { label: string; onOpen: () => void };
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <h1>{title}</h1>
        {id != null && <p className={styles.id}>{id}</p>}
        {parent != null && (
          <LinkOut onClick={parent.onOpen}>{parent.label}</LinkOut>
        )}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
