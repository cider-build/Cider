export type ResourceTab = "overview" | "metrics" | "terminal";

export function age(value: string) {
  const hours = (Date.now() - new Date(value).getTime()) / 3_600_000;
  if (hours >= 24) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${Math.floor(hours)}h`;
  return `${Math.max(1, Math.round(hours * 60))}m`;
}
