/**
 * MockPaymentProvider (default in dev, test and CI). No external calls, no API keys.
 * Checkout and portal are internal TEST MODE pages; their buttons ask this provider to emit the
 * internal events, which run through the same handleBillingEvent() path as a verified webhook.
 * Webhook: POST /webhooks/payment with `x-mock-signature: hex(HMAC-SHA256(MOCK_WEBHOOK_SECRET, body))`.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safeEqual } from '../../auth/tokens.js';
import { config } from '../../config.js';
import { BILLING_EVENT_TYPES, WebhookVerificationError, type InternalBillingEvent, type OneTimeCheckoutInput, type PaymentProvider, type PortalInput, type SubscriptionCheckoutInput } from '../types.js';

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(BILLING_EVENT_TYPES),
  workspaceId: z.string().uuid(),
  checkoutSessionId: z.string().uuid().optional(),
  kind: z.enum(['RCA_UNLOCK', 'SUBSCRIPTION']).optional(),
  rcaId: z.string().uuid().optional(),
  plan: z.enum(['SOLO', 'TEAM']).optional(),
  seats: z.number().int().min(0).max(10_000).optional(),
  subscriptionRef: z.string().max(120).optional(),
  customerRef: z.string().max(120).optional(),
  periodEnd: z.string().datetime({ offset: true }).optional(),
  amountCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  reference: z.string().max(200).optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export function signMockWebhook(body: string, secret = config.billing.mockWebhookSecret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export const mockId = (prefix: string) => `mock_${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly testMode = true;

  async createOneTimeCheckout(input: OneTimeCheckoutInput) {
    return { url: `${config.appUrl}/billing/test-checkout/${input.sessionId}`, providerSessionId: mockId('cs') };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput) {
    return { url: `${config.appUrl}/billing/test-checkout/${input.sessionId}`, providerSessionId: mockId('cs') };
  }

  async createBillingPortalSession(input: PortalInput) {
    return { url: `${config.appUrl}/billing/test-portal/${input.workspaceId}` };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<InternalBillingEvent[]> {
    const signature = headers['x-mock-signature'] ?? '';
    if (!signature || !safeEqual(signature, signMockWebhook(rawBody.toString('utf8')))) throw new WebhookVerificationError('bad mock signature');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookVerificationError('invalid JSON');
    }
    const list = z.object({ events: z.array(eventSchema).min(1).max(50) }).safeParse(parsed);
    if (!list.success) throw new WebhookVerificationError('invalid mock event payload');
    return list.data.events;
  }
}
