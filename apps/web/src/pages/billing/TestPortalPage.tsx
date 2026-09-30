import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useWorkspaceBilling } from '../../api/billing';
import { api } from '../../api/client';
import { PLAN_LABEL, TestModeBanner } from '../../components/BillingBits';
import { ErrorBanner, TextInput } from '../../components/Form';
import { SaveButton, useSaveFeedback } from '../../components/SaveButton';
import { formatDateTime } from '../../lib/dates';

type PortalAction = { action: 'renew' | 'past_due' | 'cancel' } | { action: 'seats'; seats: number };

/** Billing portal of the mock provider: simulates renewals, failed renewals, cancellation and seat changes. */
export function TestPortalPage() {
  const { wid } = useParams();
  const qc = useQueryClient();
  const b = useWorkspaceBilling(wid);
  const [seats, setSeats] = useState('');
  const fb = useSaveFeedback();
  const act = useMutation({
    mutationFn: (body: PortalAction) => api.post(`/billing/mock/portal/${wid}`, body),
    onError: (e) => fb.failed(e, 'Change'),
    onSuccess: (_r, body) => {
      if (body.action === 'seats') fb.succeeded(`Seats changed to ${body.seats}`);
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['billing-alerts'] });
    },
  });
  const d = b.data;
  return (
    <div className="min-h-screen bg-slate-50">
      <TestModeBanner />
      <div className="mx-auto mt-10 max-w-lg space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1>Test billing portal</h1>
        <ErrorBanner error={b.error ?? act.error} />
        {d && (
          <>
            <p className="text-sm" data-testid="portal-status">
              {PLAN_LABEL[d.plan]} plan · {d.subscription_status}
              {d.current_period_end && ` · period ends ${formatDateTime(d.current_period_end)}`}
              {d.plan === 'TEAM' && ` · ${d.seats_used} of ${d.seats} seats used`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'renew' })}>
                Simulate renewal
              </button>
              <button type="button" className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'past_due' })}>
                Simulate failed renewal (past due)
              </button>
              <button type="button" className="btn-danger" disabled={act.isPending} onClick={() => act.mutate({ action: 'cancel' })}>
                Cancel subscription
              </button>
            </div>
            {d.plan === 'TEAM' && (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act.mutate({ action: 'seats', seats: Number(seats) });
                }}
              >
                <label className="text-sm">
                  Seats
                  <TextInput type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder={String(d.seats)} aria-label="Seats" />
                </label>
                <SaveButton type="submit" label="Change seats" className="btn-secondary" pending={act.isPending && act.variables?.action === 'seats'} saved={fb.saved} disabled={!seats || act.isPending} />
              </form>
            )}
            {act.isSuccess && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-900">Simulated provider event delivered.</p>}
          </>
        )}
        <Link to="/settings/billing">Back to Billing</Link>
      </div>
    </div>
  );
}
