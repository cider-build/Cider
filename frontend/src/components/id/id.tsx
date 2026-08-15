import styles from "./id.module.css";

export function Id({ value, wide = false }: { value: string; wide?: boolean }) {
  return (
    <span className={styles.id} data-wide={wide || undefined} title={value}>
      {value}
    </span>
  );
}
