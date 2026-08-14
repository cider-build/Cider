import type { ReactNode } from "react";
import styles from "./icon.module.css";

export type IconName
  = | "nodes"
    | "sandboxes"
    | "servers"
    | "snapshots"
    | "search"
    | "terminal";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    nodes: (
      <>
        <rect x="4" y="5" width="16" height="11" rx="1" />
        <path d="M9 20h6M12 16v4" />
      </>
    ),
    sandboxes: (
      <>
        <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
        <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
      </>
    ),
    servers: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="1" />
        <rect x="4" y="14" width="16" height="6" rx="1" />
        <path d="M8 7h.01M8 17h.01" />
      </>
    ),
    snapshots: (
      <>
        <path d="m12 4 8 4-8 4-8-4 8-4Z" />
        <path d="m4 13 8 4 8-4M4 17l8 4 8-4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </>
    ),
  };

  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
