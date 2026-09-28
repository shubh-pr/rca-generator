import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Participant } from './types';

/** People with access to an RCA (pickers for action owners, follow-up owners and sign-off assignees). */
export function useParticipants(rcaId: string) {
  return useQuery({
    queryKey: ['participants', rcaId],
    queryFn: () => api.get<{ data: Participant[] }>(`/rcas/${rcaId}/participants`),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

/** Company and project names already used in a workspace (autocomplete). */
export function useLabels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['labels', workspaceId],
    queryFn: () => api.get<{ companies: string[]; projects: string[] }>(`/workspaces/${workspaceId}/labels`),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
