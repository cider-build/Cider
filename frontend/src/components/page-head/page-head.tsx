import type { ReactNode } from "react";
import styles from "./page-head.module.css";

export function PageHead({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      {children}
    </header>
  );
}
