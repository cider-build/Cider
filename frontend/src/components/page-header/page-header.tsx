import styles from "./page-header.module.css";

export function PageHeader({ title }: { title: string }) {
  return (
    <header className={styles.header}>
      <h2>{title}</h2>
    </header>
  );
}
