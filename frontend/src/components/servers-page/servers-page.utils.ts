import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Server, ServerConfig } from "../../api";
import { OS_RELEASES } from "../../image-catalog";

export function useServerAction(
  fn: (id: string) => Promise<unknown>,
  onFired: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: onFired,
    mutationFn: fn,
    onSuccess: (updated) => {
      const server = updated as Server | undefined;
      if (server?.id === undefined) return;
      queryClient.setQueryData<Server[]>(["servers"], (current) =>
        current?.map((item) => (item.id === server.id ? server : item)),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

export function created(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function macos(config: ServerConfig | null) {
  if (config === null) return "—";
  const release = OS_RELEASES.find((item) => item.id === config.image);
  return release ? `${release.version} ${release.name}` : config.image;
}

export function label(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
