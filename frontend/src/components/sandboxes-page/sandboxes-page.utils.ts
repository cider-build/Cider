import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Sandbox } from "../../api";

export function created(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function label(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function useSandboxAction(fn: (id: string) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (updated) => {
      const sandbox = updated as Sandbox | undefined;
      if (sandbox?.id === undefined) return;
      queryClient.setQueryData<Sandbox[]>(["sandboxes"], (current) =>
        current?.map((item) => (item.id === sandbox.id ? sandbox : item)),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sandboxes"] });
    },
  });
}
