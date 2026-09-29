/**
 * Provider-agnostic billing contract (docs/BILLING_PLAN.md section 2). Business rules react only to
 * InternalBillingEvent; providers translate their own payloads into these.
 */
export const BILLING_EVENT_TYPES = [
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_RENEWED',
  'SUBSCRIPTION_PAST_DUE',
  'SUBSCRIPTION_CANCELED',
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export type PaidPlan = 'SOLO' | 'TEAM';
export type CheckoutKind = 'RCA_UNLOCK' | 'SUBSCRIPTION';

export interface Money {
  amountCents: number;
  currency: string;
}

export interface InternalBillingEvent {
  /** Provider's event id; together with the provider name it deduplicates replays. */
  id: string;
  type: BillingEventType;
  workspaceId: string;
  /** Our checkout_sessions.id, passed to the provider as metadata. */
  checkoutSessionId?: string;
  kind?: CheckoutKind;
  rcaId?: string;
  plan?: PaidPlan;
  seats?: number;
  subscriptionRef?: string;
  customerRef?: string;
  /** ISO timestamp of the end of the paid period. */
  periodEnd?: string;
  amountCents?: number;
  currency?: string;
  /** Payment or invoice id shown in billing history. */
  reference?: string;
  occurredAt: string;
}

export interface OneTimeCheckoutInput {
  sessionId: string;
  rcaId: string;
  rcaNumber: string;
  workspaceId: string;
  amount: Money;
  customerRef?: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionCheckoutInput {
  sessionId: string;
  workspaceId: string;
  plan: PaidPlan;
  seats: number;
  amount: Money;
  customerRef?: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalInput {
  workspaceId: string;
  customerRef: string;
  returnUrl: string;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  /** True when no real money moves (the UI shows TEST MODE). */
  readonly testMode: boolean;
  createOneTimeCheckout(input: OneTimeCheckoutInput): Promise<{ url: string; providerSessionId: string }>;
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string; providerSessionId: string }>;
  createBillingPortalSession(input: PortalInput): Promise<{ url: string }>;
  /**
   * Webhook contract: verify authenticity (signature) of the raw request and translate it into internal
   * events. Must throw WebhookVerificationError when the request is not genuine.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<InternalBillingEvent[]>;
}

export class WebhookVerificationError extends Error {}
