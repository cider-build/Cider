import styles from "./page-head.module.css";

export function PageHead({ title }: { title: string }) {
  return (
    <header className={styles.head}>
      <h1>{title}</h1>
    </header>
  );
}
