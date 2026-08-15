import styles from "./status-text.module.css";

export function StatusText({ label }: { label: string }) {
  return (
    <span className={styles.status} data-status={label.toLowerCase()}>
      {label}
    </span>
  );
}
