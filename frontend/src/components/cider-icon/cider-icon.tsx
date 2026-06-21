import styles from "./cider-icon.module.css";

export function CiderIcon() {
  return (
    <svg className={styles.icon} width="28" height="26" viewBox="0 0 210 190" fill="none" aria-hidden="true">
      <rect x="60" y="0" width="120" height="50" rx="25" />
      <rect x="0" y="70" width="110" height="50" rx="25" />
      <rect className={styles.accent} x="130" y="70" width="80" height="50" rx="25" />
      <rect x="60" y="140" width="120" height="50" rx="25" />
    </svg>
  );
}
