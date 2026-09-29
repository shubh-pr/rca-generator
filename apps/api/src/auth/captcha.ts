import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile check, only when TURNSTILE_ENABLED=true. Used on signup and forgot-password.
 * Network or provider errors fail closed.
 */
export async function verifyCaptcha(token: string | undefined, ip: string | undefined) {
  if (!config.turnstile.enabled) return;
  if (!token) throw badRequest({ captcha_token: 'Complete the CAPTCHA' });
  const body = new URLSearchParams({ secret: config.turnstile.secretKey!, response: token });
  if (ip) body.set('remoteip', ip);
  let ok = false;
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    ok = res.ok && ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    ok = false;
  }
  if (!ok) throw badRequest({ captcha_token: 'CAPTCHA check failed. Try again.' });
}
