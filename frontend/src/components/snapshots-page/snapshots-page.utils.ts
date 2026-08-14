export function created(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function size(bytes: number | null) {
  if (bytes === null) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
