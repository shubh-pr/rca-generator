import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Company, Paged, Project, User } from './types';

/** All users (for pickers). Page size 500 covers the master list. */
export function useUsers(opts: { activeOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ['users', 'all', opts.activeOnly ?? false],
    queryFn: () =>
      api.get<Paged<User>>('/users', { page_size: 500, is_active: opts.activeOnly ? 'true' : undefined }),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => api.get<Paged<Project>>('/projects', { page_size: 500 }),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies', 'all'],
    queryFn: () => api.get<Paged<Company>>('/companies', { page_size: 500 }),
    select: (r) => r.data,
    staleTime: 60_000,
  });
}
