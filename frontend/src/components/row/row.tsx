import type { ReactNode } from "react";
import styles from "./row.module.css";

export function Row({
  onOpen,
  children,
}: {
  onOpen?: () => void;
  children: ReactNode;
}) {
  function open(event: React.MouseEvent<HTMLTableRowElement>) {
    if (onOpen === undefined) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    if ((window.getSelection()?.toString() ?? "").trim() !== "") return;
    onOpen();
  }

  return (
    <tr
      className={styles.row}
      data-clickable={onOpen === undefined ? undefined : ""}
      tabIndex={onOpen === undefined ? undefined : 0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen?.();
      }}
    >
      {children}
    </tr>
  );
}
