import styles from "./list-page.module.css";

export const PER_PAGE = 10;

export const listClasses = {
  row: styles.lrow,
  headRow: `${styles.lrow} ${styles.lhead}`,
  name: styles.name,
  cell: styles.cell,
  num: styles.num,
  page: styles.page,
  error: styles.error,
  mono: styles.mono,
  statusCell: styles.statusCell,
};

export function paginate<T>(items: T[], page: number) {
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / PER_PAGE) - 1));
  return { current, items: items.slice(current * PER_PAGE, (current + 1) * PER_PAGE) };
}

type HistoricalItem = { created_at: string; deleted_at?: string | null };

export function weeklyActivity(items: HistoricalItem[], now: number) {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const since = (value: string | null | undefined) => value != null && new Date(value).getTime() >= weekAgo;
  return {
    created: items.filter((item) => since(item.created_at)).length,
    deleted: items.filter((item) => since(item.deleted_at)).length,
  };
}

export function buildSeries(items: HistoricalItem[], now: number, days = 14): number[] {
  const spans = items
    .map((item) => ({
      from: new Date(item.created_at).getTime(),
      to: item.deleted_at ? new Date(item.deleted_at).getTime() : Infinity,
    }))
    .filter((span) => !Number.isNaN(span.from));
  return Array.from({ length: days }, (_, index) => {
    const end = new Date(now);
    end.setDate(end.getDate() - days + index + 1);
    end.setHours(23, 59, 59, 999);
    return spans.filter((span) => span.from <= end.getTime() && span.to > end.getTime()).length;
  });
}
