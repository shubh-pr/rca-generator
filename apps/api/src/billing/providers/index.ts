import { config } from '../../config.js';
import type { PaymentProvider } from '../types.js';
import { MockPaymentProvider } from './mock.js';
import { StripePaymentProvider } from './stripe.js';

let instance: PaymentProvider | undefined;

/** The active provider, chosen by PAYMENT_PROVIDER (default mock). */
export function paymentProvider(): PaymentProvider {
  instance ??= config.billing.provider === 'stripe' ? new StripePaymentProvider() : new MockPaymentProvider();
  return instance;
}

export function setPaymentProvider(p: PaymentProvider) {
  instance = p;
}
