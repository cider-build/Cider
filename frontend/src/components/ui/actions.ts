import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ResourceKind } from "../../api";

export function useListAction<Item extends { id: string }>(
  key: string,
  fn: (id: string) => Promise<unknown>,
  onFired?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: onFired,
    onSuccess: (updated) => {
      const item = updated as Item | undefined;
      if (item?.id === undefined) return;
      queryClient.setQueryData<Item[]>([key], (current) =>
        current?.map((existing) => (existing.id === item.id ? item : existing)),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useResourceAction(
  fn: (resourceId: string) => Promise<unknown>,
  kind: ResourceKind,
  id: string,
  onFired: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fn(id),
    onMutate: onFired,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [kind, id, "detail"] });
      await queryClient.invalidateQueries({ queryKey: [`${kind}s`] });
    },
  });
}
