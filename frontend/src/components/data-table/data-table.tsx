import type { ReactNode } from "react";
import styles from "./data-table.module.css";

export function DataTable({
  head,
  rows = 15,
  children,
  empty,
  error,
}: {
  head: ReactNode[];
  rows?: number;
  children: ReactNode;
  empty?: ReactNode;
  error?: string | null;
}) {
  const count = Array.isArray(children)
    ? children.flat().length
    : children == null
      ? 0
      : 1;

  return (
    <div className={styles.tableWrap} style={{ minHeight: rows * 33 + 28 }}>
      {error != null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {count === 0 && empty != null && <p className={styles.empty}>{empty}</p>}
    </div>
  );
}
