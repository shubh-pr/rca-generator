import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { goToCheckout, money, usePricing, useWorkspaceBilling } from '../../api/billing';
import { api } from '../../api/client';
import type { BillingHistoryRow, Paged, Pricing, WorkspaceBilling, WorkspaceRef } from '../../api/types';
import { CheckoutNotice, PLAN_LABEL } from '../../components/BillingBits';
import { ErrorBanner, TextInput } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';
import { SettingsTabs } from './SettingsTabs';

const STATUS_LABEL = { NONE: 'No subscription', ACTIVE: 'Active', PAST_DUE: 'Past due', CANCELED: 'Canceled' } as const;

export function BillingPage() {
  const { user } = useAuth();
  const pricing = usePricing();
  const owned = user?.workspaces.filter((w) => w.is_primary_owner) ?? [];
  return (
    <div className="max-w-3xl space-y-6">
      <h1>Account settings</h1>
      <SettingsTabs />
      <CheckoutNotice />
      {pricing.data?.test_mode && (
        <p className="inline-block rounded bg-amber-300 px-2 py-1 text-xs font-bold text-amber-950" data-testid="test-mode">
          TEST MODE: payments are simulated, nothing is charged
        </p>
      )}
      <p className="text-sm text-slate-600">
        Billing is per workspace and managed by its owner. <Link to="/pricing">Compare plans</Link>
      </p>
      {owned.length === 0 && <p className="card text-slate-600">You do not own a workspace. Billing is managed by each workspace's owner.</p>}
      {pricing.data && owned.map((w) => <WorkspaceBillingCard key={w.id} ws={w} pricing={pricing.data} />)}
    </div>
  );
}

function WorkspaceBillingCard({ ws, pricing }: { ws: WorkspaceRef; pricing: Pricing }) {
  const b = useWorkspaceBilling(ws.id);
  const d = b.data;
  return (
    <section className="card space-y-3" data-testid={`billing-${ws.id}`} aria-label={`Billing for ${ws.name}`}>
      <h2>{ws.name}</h2>
      <ErrorBanner error={b.error} />
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div>
              <dt className="text-slate-500">Plan</dt>
              <dd className="font-semibold" data-testid="billing-plan">
                {PLAN_LABEL[d.plan]}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className={d.subscription_status === 'PAST_DUE' || d.subscription_status === 'CANCELED' ? 'font-semibold text-red-700' : ''} data-testid="billing-status">
                {STATUS_LABEL[d.subscription_status]}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{d.subscription_status === 'ACTIVE' ? 'Renews' : 'Period end'}</dt>
              <dd>{d.current_period_end ? formatDateTime(d.current_period_end) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{d.plan === 'TEAM' ? 'Seats used' : 'Unpaid RCAs'}</dt>
              <dd>{d.plan === 'TEAM' ? `${d.seats_used} of ${d.seats}` : d.bucket.applies ? `${d.bucket.unpaid} of ${d.bucket.limit}` : 'Unlimited'}</dd>
            </div>
          </dl>
          {(d.subscription_status === 'PAST_DUE' || d.subscription_status === 'CANCELED') && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-900">
              Free-plan limits and the watermark apply again. RCAs you paid for stay unlocked, and collaborators are read-only until you subscribe again.
            </p>
          )}
          {d.has_billing_account && <PortalButton workspaceId={ws.id} />}
          {!d.entitled && <Subscribe ws={ws} billing={d} pricing={pricing} />}
          <History workspaceId={ws.id} />
        </>
      )}
    </section>
  );
}

function PortalButton({ workspaceId }: { workspaceId: string }) {
  const portal = useMutation({
    mutationFn: async () => {
      const { portal_url } = await api.post<{ portal_url: string }>('/billing/portal', { workspace_id: workspaceId });
      window.location.assign(portal_url);
    },
  });
  return (
    <div>
      <button type="button" className="btn-secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
        Manage billing
      </button>
      <ErrorBanner error={portal.error} />
    </div>
  );
}

function Subscribe({ ws, billing, pricing }: { ws: WorkspaceRef; billing: WorkspaceBilling; pricing: Pricing }) {
  const minSeats = Math.max(pricing.team.min_seats, billing.seats_used);
  const [seats, setSeats] = useState(String(minSeats));
  const start = useMutation({
    mutationFn: (body: { plan: 'SOLO' | 'TEAM'; seats?: number }) => goToCheckout(api.post<{ checkout_url: string }>('/billing/subscribe', { workspace_id: ws.id, ...body })),
  });
  const n = Number(seats) || 0;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded border border-slate-200 p-3">
        <h3 className="font-semibold">Solo</h3>
        <p className="text-sm text-slate-600">
          {money(pricing.solo.amount_cents, pricing.currency)} per {pricing.solo.interval}. Unlimited RCAs, no watermark, no invitations.
        </p>
        <button type="button" className="btn-primary mt-2" disabled={start.isPending} onClick={() => start.mutate({ plan: 'SOLO' })}>
          Subscribe to Solo
        </button>
      </div>
      <div className="rounded border border-slate-200 p-3">
        <h3 className="font-semibold">Team</h3>
        <p className="text-sm text-slate-600">
          {money(pricing.team.base_cents, pricing.currency)} + {money(pricing.team.seat_cents, pricing.currency)} per seat per {pricing.team.interval}. Invite collaborators.
        </p>
        <div className="mt-2 flex items-end gap-2">
          <label className="text-sm">
            Seats
            <TextInput type="number" min={minSeats} max={pricing.team.max_seats} value={seats} onChange={(e) => setSeats(e.target.value)} aria-label="Team seats" className="w-24" />
          </label>
          <button type="button" className="btn-primary" disabled={start.isPending || n < minSeats} onClick={() => start.mutate({ plan: 'TEAM', seats: n })}>
            Subscribe to Team ({money(pricing.team.base_cents + pricing.team.seat_cents * n, pricing.currency)})
          </button>
        </div>
        {billing.seats_used > 0 && <p className="mt-1 text-xs text-slate-500">{billing.seats_used} people already have access or a pending invitation.</p>}
      </div>
      <div className="md:col-span-2">
        <ErrorBanner error={start.error} />
      </div>
    </div>
  );
}

function History({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({
    queryKey: ['billing', workspaceId, 'history'],
    queryFn: () => api.get<Paged<BillingHistoryRow>>(`/billing/workspaces/${workspaceId}/history`, { page_size: 50 }),
  });
  const rows = q.data?.data ?? [];
  return (
    <div>
      <h3 className="mb-1 font-semibold">Invoice history</h3>
      <ErrorBanner error={q.error} />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No payments yet.</p>
      ) : (
        <table className="w-full text-sm" data-testid="billing-history">
          <thead>
            <tr className="text-left text-slate-500">
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td>{formatDateTime(r.occurred_at)}</td>
                <td>{r.description}</td>
                <td>{money(r.amount_cents, r.currency)}</td>
                <td className={r.status === 'FAILED' ? 'text-red-700' : ''}>{r.status === 'PAID' ? 'Paid' : 'Failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
