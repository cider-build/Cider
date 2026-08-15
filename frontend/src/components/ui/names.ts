export function sandboxName(id: string) {
  return `cider-${id}`;
}

export function displayGb(bytes: number) {
  const gb = bytes / 1024 ** 3;
  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

export function bytes(value: number | null) {
  if (value === null) return "—";
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function label(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function created(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function required(value: string | undefined, name: string) {
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}

const SETTLED = new Set([
  "running",
  "stopped",
  "failed",
  "active",
  "paused",
  "deleted",
]);

export function isTransitional(status: string) {
  return !SETTLED.has(status.toLowerCase());
}

export function pollWhileTransitional<
  T extends { status: string; deleted_at?: string | null },
>(items: T[] | undefined) {
  if (items === undefined) return false as const;
  return items.some(
    (item) => item.deleted_at == null && isTransitional(item.status),
  )
    ? 2000
    : (false as const);
}

const WATCH_MS = 120_000;

export function pollAfterAction(startedAt: number | null) {
  if (startedAt === null) return false as const;
  return Date.now() - startedAt < WATCH_MS ? 2000 : (false as const);
}
