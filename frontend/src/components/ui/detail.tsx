import type { ReactNode } from "react";
import { LinkOut, Sparkline } from "./ui";
import styles from "./detail.module.css";

export function DetailHead({
  title,
  id,
  parent,
  actions,
}: {
  title: string;
  id?: string;
  parent?: { label: string; onOpen: () => void };
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <h1>{title}</h1>
        {id != null && <p className={styles.id}>{id}</p>}
        {parent != null && (
          <LinkOut onClick={parent.onOpen}>{parent.label}</LinkOut>
        )}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function DetailTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: Array<{
    id: string;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={tab.id === active ? "page" : undefined}
          disabled={tab.disabled}
          title={tab.title}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function DetailPane({
  children,
  tabbed = false,
}: {
  children: ReactNode;
  tabbed?: boolean;
}) {
  return (
    <div className={styles.pane} data-tabbed={tabbed || undefined}>
      {children}
    </div>
  );
}

export function Signals({
  items,
}: {
  items: Array<{ label: string; value: string; series?: number[] }>;
}) {
  return (
    <div className={styles.signals}>
      {items.map((item) => (
        <div className={styles.signal} key={item.label}>
          <b>{item.value}</b>
          <span>{item.label}</span>
          {item.series != null && item.series.length > 0 && (
            <div className={styles.chart}>
              <Sparkline values={item.series} color="#ff8200" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.grid}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
