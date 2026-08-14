import type { ReactNode } from "react";
import { Dropdown, Icon } from "./ui";
import styles from "./list.module.css";

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

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className={styles.search}>
      <Icon name="search" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

export function StatusFilter({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown
      label="Status"
      value={value}
      options={options.map((option) => ({ value: option, label: option }))}
      onChange={onChange}
      width={178}
    />
  );
}

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

export function RowActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function Pager({
  page,
  pages,
  total,
  shown,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
}) {
  const from = total === 0 ? 0 : page * shown + 1;
  const to = Math.min(total, (page + 1) * shown);
  return (
    <div className={styles.foot}>
      <span>{total === 0 ? "No records" : `${from} to ${to} of ${total}`}</span>
      {pages > 1 && (
        <div className={styles.pages}>
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              className={
                index === page
                  ? `${styles.page} ${styles.current}`
                  : styles.page
              }
              aria-current={index === page ? "page" : undefined}
              aria-label={`Page ${index + 1}`}
              onClick={() => onPage(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
