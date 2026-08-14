export function sandboxName(id: string) {
  return `cider-${id}`;
}

export function displayGb(bytes: number) {
  const gb = bytes / 1024 ** 3;
  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
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
