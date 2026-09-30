import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { goToCheckout, money, useBillingAlerts, usePricing, useWorkspaceBilling } from '../api/billing';
import type { Me, Rca, WorkspaceRef } from '../api/types';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from './Form';

export const PLAN_LABEL = { NONE: 'Free', SOLO: 'Solo', TEAM: 'Team' } as const;

/** The workspace whose bucket to show: the selected one, else the user's personal workspace. */
export function bucketWorkspaceId(user: Me | null, current: WorkspaceRef | null) {
  return (current ?? user?.workspaces.find((w) => w.is_personal && w.is_primary_owner))?.id;
}

/** Result message after returning from a checkout (?checkout=done|canceled). */
export function CheckoutNotice() {
  const [params, setParams] = useSearchParams();
  const result = params.get('checkout');
  if (!result) return null;
  const ok = result === 'done';
  return (
    <div className={`mb-4 flex items-center justify-between rounded px-3 py-2 text-sm ${ok ? 'bg-green-50 text-green-900' : 'bg-slate-100 text-slate-800'}`} role="status" data-testid="checkout-notice">
      <span>{ok ? 'Payment received. Your purchase is active once the payment provider confirms it; this usually takes a few seconds.' : 'Checkout was canceled. Nothing was charged.'}</span>
      <button
        type="button"
        className="underline"
        onClick={() => {
          params.delete('checkout');
          setParams(params, { replace: true });
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

/** "Free plan: 2 of 3 unpaid RCAs" for a workspace; nothing while subscribed. */
export function BucketIndicator({ workspaceId }: { workspaceId: string | undefined }) {
  const b = useWorkspaceBilling(workspaceId);
  if (!b.data) return null;
  if (!b.data.bucket.applies) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800" data-testid="plan-chip">
        {PLAN_LABEL[b.data.plan]} plan
      </span>
    );
  }
  const { unpaid, limit, full } = b.data.bucket;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-semibold ${full ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`} data-testid="bucket-indicator">
      Free plan: {unpaid} of {limit} unpaid RCAs
      <Link to="/pricing" className="underline">
        {full ? 'Unlock more' : 'Plans'}
      </Link>
    </span>
  );
}

/** Warning for owners whose subscription is past due or canceled. */
export function BillingAlertBanner() {
  const { user } = useAuth();
  const alerts = useBillingAlerts(!!user);
  if (!alerts.data?.length) return null;
  return (
    <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert" data-testid="billing-alert">
      {alerts.data.map((a) => (
        <div key={a.id}>
          <strong>{a.name}:</strong> your {PLAN_LABEL[a.plan as 'SOLO' | 'TEAM'] ?? ''} subscription is {a.subscription_status === 'PAST_DUE' ? 'past due (payment failed)' : 'canceled'}. The free-plan
          limits and watermark apply again and collaborators are read-only until it is active.{' '}
          <Link to="/settings/billing" className="font-semibold underline">
            Go to Billing
          </Link>
        </div>
      ))}
    </div>
  );
}

/** Start the per-RCA unlock checkout (the watermark bar and the Word export prompt use the same one). */
export function useUnlockCheckout(rcaId: string) {
  return useMutation({ mutationFn: () => goToCheckout(api.post<{ checkout_url: string }>(`/billing/rca/${rcaId}/checkout`)) });
}

/** Watermark / paid state of one RCA, with "Unlock this RCA" and "Remove watermark — subscribe". */
export function RcaBillingBar({ rca }: { rca: Rca }) {
  const pricing = usePricing();
  const unlock = useUnlockCheckout(rca.id);
  if (rca.permissions.read_only_reason === 'SUBSCRIPTION_INACTIVE') {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="read-only-banner">
        You have read-only access: this workspace's Team subscription is not active. Ask the workspace owner to renew it.
      </div>
    );
  }
  if (rca.billing.paid) {
    return (
      <p className="mb-2">
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800" data-testid="paid-badge">
          Unlocked: exports without watermark
        </span>
      </p>
    );
  }
  if (!rca.billing.watermarked) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm" data-testid="watermark-bar">
      <span>
        <strong>Free plan:</strong> print and PDF exports of this RCA carry a watermark, and Word export needs an unlock or a subscription.
      </span>
      {rca.permissions.edit && (
        <button type="button" className="btn-primary" disabled={unlock.isPending} onClick={() => unlock.mutate()}>
          Unlock this RCA{pricing.data ? ` (${money(pricing.data.rca_unlock.amount_cents, pricing.data.currency)})` : ''}
        </button>
      )}
      <Link to="/pricing" className="btn-secondary">
        Remove watermark — subscribe
      </Link>
      <ErrorBanner error={unlock.error} />
    </div>
  );
}

export function TestModeBanner() {
  return (
    <div className="bg-amber-400 px-4 py-2 text-center text-sm font-bold text-amber-950" role="status" data-testid="test-mode">
      TEST MODE — no real payment is taken. The mock payment provider is active.
    </div>
  );
}
