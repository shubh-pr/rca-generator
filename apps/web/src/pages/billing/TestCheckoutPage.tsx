import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { money } from '../../api/billing';
import { api } from '../../api/client';
import { TestModeBanner } from '../../components/BillingBits';
import { ErrorBanner } from '../../components/Form';

interface MockSession {
  id: string;
  kind: 'RCA_UNLOCK' | 'SUBSCRIPTION';
  plan: 'SOLO' | 'TEAM' | null;
  seats: number | null;
  amount_cents: number;
  currency: string;
  status: 'OPEN' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  rca: { id: string; rca_number: string } | null;
  workspace_name: string;
}

/**
 * Checkout page of the mock payment provider. It stands in for Stripe Checkout: the buttons simulate
 * what the provider would report, and the server turns that into a signed provider event.
 */
export function TestCheckoutPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['mock-session', sessionId], queryFn: () => api.get<MockSession>(`/billing/mock/sessions/${sessionId}`) });
  const s = q.data;
  const back = (result: string) => (s?.rca ? `/rcas/${s.rca.id}?checkout=${result}` : `/settings/billing?checkout=${result}`);
  const complete = useMutation({
    mutationFn: (outcome: 'success' | 'failure' | 'cancel') => api.post(`/billing/mock/sessions/${sessionId}/complete`, { outcome }),
    onSuccess: (_r, outcome) => {
      if (outcome !== 'failure') navigate(back(outcome === 'success' ? 'done' : 'canceled'));
      else void q.refetch();
    },
  });
  return (
    <div className="min-h-screen bg-slate-50">
      <TestModeBanner />
      <div className="mx-auto mt-10 max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1>Test checkout</h1>
        <ErrorBanner error={q.error ?? complete.error} />
        {s && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="checkout-summary">
              <dt className="text-slate-500">Workspace</dt>
              <dd>{s.workspace_name}</dd>
              <dt className="text-slate-500">Item</dt>
              <dd>{s.kind === 'RCA_UNLOCK' ? `Unlock ${s.rca?.rca_number}` : `${s.plan === 'TEAM' ? 'Team' : 'Solo'} plan${s.plan === 'TEAM' ? `, ${s.seats} seats` : ''} (monthly)`}</dd>
              <dt className="text-slate-500">Amount</dt>
              <dd className="font-semibold">{money(s.amount_cents, s.currency)}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd data-testid="checkout-status">{s.status}</dd>
            </dl>
            {s.status === 'FAILED' && (
              <>
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">The simulated payment failed. Nothing was charged and nothing changed. Start a new checkout to try again.</p>
                <button type="button" className="btn-secondary" onClick={() => navigate(s.rca ? `/rcas/${s.rca.id}` : '/settings/billing')}>
                  Start over
                </button>
              </>
            )}
            {s.status === 'OPEN' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={complete.isPending} onClick={() => complete.mutate('success')}>
                  Simulate successful payment
                </button>
                <button type="button" className="btn-secondary" disabled={complete.isPending} onClick={() => complete.mutate('failure')}>
                  Simulate failed payment
                </button>
                <button type="button" className="btn-secondary" disabled={complete.isPending} onClick={() => complete.mutate('cancel')}>
                  Cancel
                </button>
              </div>
            )}
            {s.status === 'COMPLETED' && (
              <button type="button" className="btn-primary" onClick={() => navigate(back('done'))}>
                Continue
              </button>
            )}
            {s.status === 'CANCELED' && (
              <button type="button" className="btn-secondary" onClick={() => navigate(back('canceled'))}>
                Back
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
