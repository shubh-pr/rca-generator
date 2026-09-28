import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Paged, Rca, RcaSummary } from '../../api/types';

export const rcaKey = (id: string) => ['rca', id] as const;

export function useRca(id: string) {
  return useQuery({ queryKey: rcaKey(id), queryFn: () => api.get<Rca>(`/rcas/${id}`) });
}

export type RcaListQuery = Record<string, string | number | undefined>;

export function useRcaList(query: RcaListQuery) {
  return useQuery({
    queryKey: ['rcas', query],
    queryFn: () => api.get<Paged<RcaSummary>>('/rcas', query),
    placeholderData: (prev) => prev,
  });
}

/** Mutation that refreshes the RCA (and lists) on success. */
export function useRcaMutation<TVars, TResult = unknown>(id: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: rcaKey(id) });
      qc.invalidateQueries({ queryKey: ['rcas'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
