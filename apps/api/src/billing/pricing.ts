import { config } from '../config.js';
import type { Money, PaidPlan } from './types.js';

/** All prices in one place, from env (docs/BILLING_PLAN.md section 3). Amounts are in minor units. */
export function pricing() {
  const b = config.billing;
  return {
    currency: b.currency,
    freeRcaLimit: b.freeRcaLimit,
    rcaUnlock: { amountCents: b.prices.rcaUnlock, currency: b.currency } satisfies Money,
    solo: { amountCents: b.prices.soloMonthly, currency: b.currency, interval: 'month' as const },
    team: { baseCents: b.prices.teamBase, seatCents: b.prices.teamSeat, currency: b.currency, interval: 'month' as const, minSeats: b.teamSeats.min, maxSeats: b.teamSeats.max },
  };
}

export function subscriptionPrice(plan: PaidPlan, seats: number): Money {
  const p = pricing();
  if (plan === 'SOLO') return { amountCents: p.solo.amountCents, currency: p.currency };
  return { amountCents: p.team.baseCents + p.team.seatCents * seats, currency: p.currency };
}

/** Public price list for the pricing page. */
export function publicPricing(testMode: boolean) {
  const p = pricing();
  return {
    currency: p.currency,
    test_mode: testMode,
    free: { rca_limit: p.freeRcaLimit, watermark: true },
    rca_unlock: { amount_cents: p.rcaUnlock.amountCents },
    solo: { amount_cents: p.solo.amountCents, interval: p.solo.interval },
    team: { base_cents: p.team.baseCents, seat_cents: p.team.seatCents, interval: p.team.interval, min_seats: p.team.minSeats, max_seats: p.team.maxSeats },
  };
}
