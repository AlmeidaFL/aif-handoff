import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomizableAgentRole } from "@aif/shared/browser";
import { api } from "@/lib/api";

export function useAgentCustomizations(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["agentCustomizations", projectId],
    queryFn: () => api.listAgentCustomizations(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30_000,
  });
}

export function useUpsertAgentCustomization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      agentRole,
      customInstructions,
    }: {
      projectId: string;
      agentRole: CustomizableAgentRole;
      customInstructions: string;
    }) => api.upsertAgentCustomization(projectId, agentRole, customInstructions),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agentCustomizations", variables.projectId] });
    },
  });
}
