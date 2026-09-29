import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Pricing, SubscriptionStatus, WorkspaceBilling } from './types';

export function usePricing() {
  return useQuery({ queryKey: ['pricing'], queryFn: () => api.get<Pricing>('/billing/pricing'), staleTime: 5 * 60_000 });
}

export function useWorkspaceBilling(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['billing', workspaceId],
    queryFn: () => api.get<WorkspaceBilling>(`/billing/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  });
}

export function useBillingAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['billing-alerts'],
    queryFn: () => api.get<{ data: { id: string; name: string; plan: string; subscription_status: SubscriptionStatus }[] }>('/billing/alerts'),
    enabled,
    select: (r) => r.data,
  });
}

/** Start a checkout and hand the browser to the provider (mock: our TEST MODE page). */
export async function goToCheckout(start: Promise<{ checkout_url: string }>) {
  const { checkout_url } = await start;
  window.location.assign(checkout_url);
}

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
