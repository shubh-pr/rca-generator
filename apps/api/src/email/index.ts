import { createEmailProvider, type EmailMessage, type EmailProvider } from './provider.js';

export { templates } from './templates.js';
export { ConsoleEmailProvider } from './provider.js';

let provider: EmailProvider = createEmailProvider();
const pending = new Set<Promise<void>>();

export function emailProvider(): EmailProvider {
  return provider;
}

/** For tests: swap the provider. */
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

/**
 * Send in the background so the HTTP response time does not depend on whether an email was sent
 * (no account enumeration by timing). Failures are logged, never shown to the requester.
 */
export function sendEmail(to: string, template: string, rendered: { subject: string; text: string; html: string }) {
  const message: EmailMessage = { to, template, ...rendered };
  const p = provider
    .send(message)
    .catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'email send failed', template, error: String(err) })))
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Wait for queued emails (tests, graceful shutdown). */
export async function flushEmails() {
  await Promise.all([...pending]);
}
