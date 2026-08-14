import type { ReactNode } from "react";
import styles from "./link-out.module.css";

export function LinkOut({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.link} onClick={onClick}>
      {children}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 16 16 8M9 8h7v7" />
      </svg>
    </button>
  );
}
