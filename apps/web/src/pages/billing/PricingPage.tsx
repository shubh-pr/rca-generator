import { Link } from 'react-router';
import { money, usePricing } from '../../api/billing';
import { ErrorBanner } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { PublicLayout } from '../public/PublicLayout';

export function PricingPage() {
  const { user } = useAuth();
  const q = usePricing();
  const p = q.data;
  const cta = user ? '/settings/billing' : '/signup';
  return (
    <PublicLayout>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl">Pricing</h1>
        <p className="mt-2 text-slate-600">Start free. Pay once for a single RCA, or subscribe when you use it every week. Prices in {p?.currency ?? 'USD'}.</p>
        {p?.test_mode && (
          <p className="mt-3 inline-block rounded bg-amber-300 px-2 py-1 text-xs font-bold text-amber-950" data-testid="test-mode">
            TEST MODE: payments are simulated
          </p>
        )}
        <ErrorBanner error={q.error} />
        {p && (
          <div className="mt-8 grid gap-4 md:grid-cols-4" data-testid="pricing">
            <Plan
              name="Free"
              price={money(0, p.currency)}
              items={[`Up to ${p.free.rca_limit} unpaid RCAs per workspace`, 'Every feature for your own RCAs', 'Watermark on print, PDF and Word']}
              cta={user ? undefined : { to: '/signup', label: 'Sign up free' }}
            />
            <Plan
              name="Unlock one RCA"
              price={money(p.rca_unlock.amount_cents, p.currency)}
              unit="one-time"
              items={['Removes the watermark from that RCA for good', 'Frees a slot in the free bucket', 'Buy it from the RCA page']}
            />
            <Plan
              name="Solo"
              price={money(p.solo.amount_cents, p.currency)}
              unit={`per ${p.solo.interval}`}
              items={['Unlimited RCAs', 'No watermark', 'Just you: no invitations']}
              cta={{ to: cta, label: 'Subscribe to Solo' }}
            />
            <Plan
              name="Team"
              price={money(p.team.base_cents, p.currency)}
              unit={`per ${p.team.interval} + ${money(p.team.seat_cents, p.currency)} per seat`}
              items={['Everything in Solo', 'Invite editors, contributors and viewers', `${p.team.min_seats}–${p.team.max_seats} seats; you are not a seat`]}
              cta={{ to: cta, label: 'Subscribe to Team' }}
            />
          </div>
        )}
        <p className="mt-8 text-sm text-slate-600">
          If a subscription lapses, RCAs you paid for stay unlocked, nothing is deleted, and collaborators keep read-only access until it is renewed.{' '}
          <Link to="/terms">Terms</Link>
        </p>
      </div>
    </PublicLayout>
  );
}

function Plan({ name, price, unit, items, cta }: { name: string; price: string; unit?: string; items: string[]; cta?: { to: string; label: string } }) {
  return (
    <div className="flex flex-col rounded-lg border border-slate-200 p-4" data-testid={`plan-${name}`}>
      <h2 className="text-lg">{name}</h2>
      <p className="mt-2 text-2xl font-bold text-navy">{price}</p>
      {unit && <p className="text-xs text-slate-500">{unit}</p>}
      <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {cta && (
        <Link to={cta.to} className="btn-primary mt-4 text-center">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
