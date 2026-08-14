import { useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { OS_RELEASES } from "../../image-catalog";

export type ResourceKind = "server" | "sandbox";
export type ResourceTab = "overview" | "metrics" | "terminal";

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

export function age(value: string) {
  const hours = (Date.now() - new Date(value).getTime()) / 3_600_000;
  if (hours >= 24) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${Math.floor(hours)}h`;
  return `${Math.max(1, Math.round(hours * 60))}m`;
}

export function bytes(value: number | null) {
  if (value === null) return "—";
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function macos(image: string | undefined) {
  if (image === undefined) return "—";
  const release = OS_RELEASES.find((item) => image.includes(item.id));
  return release ? `${release.version} ${release.name}` : image;
}

export function useResourceAction(
  fn: (resourceId: string) => Promise<unknown>,
  kind: ResourceKind,
  id: string,
  queryClient: QueryClient,
  onFired: () => void,
) {
  return useMutation({
    mutationFn: () => fn(id),
    onMutate: onFired,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [kind, id, "detail"] });
      await queryClient.invalidateQueries({ queryKey: [`${kind}s`] });
    },
  });
}

export function required(value: string | undefined, name: string) {
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}
