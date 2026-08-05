import type { ReactNode } from "react";
import styles from "./list-page.module.css";

const PER_PAGE = 10;

/**
 * Shared class names for list rows. Pages compose these with their own
 * column templates (set `gridTemplateColumns` inline or in the page module).
 * The head row gets both `row` and `headRow`.
 */
export const listClasses = {
  row: styles.lrow,
  headRow: `${styles.lrow} ${styles.lhead}`,
  name: styles.name,
  cell: styles.cell,
  num: styles.num,
};

/** L's .list-grid: main column + sticky 240px rail directly on the page background. */
export function ListGrid({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.listGrid}>
      <div className={styles.listMain}>{children}</div>
      <aside className={styles.rail}>{rail}</aside>
    </div>
  );
}

/** L's .panel white card. */
export function Panel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}

/** Grey-ramp text-only status. No dots, no pills, no color. */
export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      className={styles.spinner}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StatusText({ tone, children }: { tone: "ok" | "warm" | "gone"; children: ReactNode }) {
  return <span className={`${styles.st} ${styles[tone]}`}>{children}</span>;
}

/**
 * Fixed 10-slot list body: always exactly 10 row-heights (460px) tall, plus a
 * footer with the range readout and numbered page buttons (rendered only when
 * there is more than one page). `page` is zero-based; `children` are the up to
 * 10 rendered rows for the current page (or an EmptyState).
 */
export function FixedList({
  page,
  totalItems,
  onPage,
  children,
}: {
  page: number;
  totalItems: number;
  onPage: (page: number) => void;
  children: ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PER_PAGE));
  const current = Math.min(Math.max(page, 0), totalPages - 1);
  const start = current * PER_PAGE;
  const shown = Math.min(PER_PAGE, totalItems - start);
  const range = totalItems > 0 ? `Showing ${start + 1}–${start + shown} of ${totalItems}` : "Showing 0 of 0";
  return (
    <>
      <div className={styles.rows}>{children}</div>
      <div className={styles.foot}>
        <span className={styles.range}>{range}</span>
        <div className={styles.pages}>
          {totalPages > 1 &&
            Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                type="button"
                className={i === current ? `${styles.pgbtn} ${styles.cur}` : styles.pgbtn}
                aria-current={i === current ? "page" : undefined}
                aria-label={`Page ${i + 1}`}
                onClick={() => onPage(i)}
              >
                {i + 1}
              </button>
            ))}
        </div>
      </div>
    </>
  );
}

/** Centered empty state for a zero-item list (renders inside FixedList). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      {children != null && <span>{children}</span>}
    </div>
  );
}

function Sparkline({ series }: { series: number[] }) {
  const w = 240;
  const h = 44;
  const pad = 3;
  if (series.length === 0) return null;
  const points = series.length === 1 ? [series[0], series[0]] : series;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) * (h - pad * 2)) / (max - min));
  const pts = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const endX = x(points.length - 1).toFixed(1);
  const endY = y(points[points.length - 1]).toFixed(1);
  const base = (h - pad).toFixed(1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon fill="#f5f5f5" points={`${x(0).toFixed(1)},${base} ${pts} ${endX},${base}`} />
      <polyline fill="none" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      <circle cx={endX} cy={endY} r="2.5" fill="#171717" />
    </svg>
  );
}

/**
 * The rail's opening section: one hero figure over the page's single
 * full-width sparkline, with a quiet caption below.
 */
export function RailHero({
  value,
  label,
  caption,
  series,
}: {
  value: ReactNode;
  label: string;
  caption: string;
  series: number[];
}) {
  return (
    <section className={styles.railsec}>
      <div className={styles.hero}>
        <b>{value}</b>
        <span>{label}</span>
      </div>
      <div className={styles.railtrend}>
        <Sparkline series={series} />
        <p className={styles.cap}>{caption}</p>
      </div>
    </section>
  );
}

/** A ledger section: quiet sentence-case title, then hairline key-value rows. */
export function RailSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[ReactNode, ReactNode]>;
}) {
  return (
    <section className={styles.railsec}>
      <h3>{title}</h3>
      <div className={styles.railrows}>
        {rows.map(([label, value], i) => (
          <div key={i}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Cumulative series from real timestamps: for each of the last `days` calendar
 * days (ending today), the count of items created by the end of that day.
 */
/** True history: an item counts on a day if it existed at that day's end.
 *  Pass tombstones too (deleted_at set) — deletions shape the curve. */
export function buildSeries(
  items: { created_at: string; deleted_at?: string | null }[],
  days = 14,
): number[] {
  const spans = items
    .map((item) => ({
      from: new Date(item.created_at).getTime(),
      to: item.deleted_at ? new Date(item.deleted_at).getTime() : Infinity,
    }))
    .filter((span) => !Number.isNaN(span.from));
  const series: number[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const end = new Date();
    end.setDate(end.getDate() - back);
    end.setHours(23, 59, 59, 999);
    const endTime = end.getTime();
    series.push(spans.filter((span) => span.from <= endTime && span.to > endTime).length);
  }
  return series;
}
