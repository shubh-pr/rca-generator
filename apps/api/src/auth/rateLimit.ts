import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * Fixed-window counters in process memory. Suitable for one API instance; run more than one instance
 * behind a load balancer only with sticky sessions or a shared store (see docs/ASSUMPTIONS.md).
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  return { allowed: w.count <= limit, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) };
}

/** Throw 429 when any of the keys is over its limit. */
export function enforce(rules: { key: string; limit: number; windowMs: number }[]) {
  if (!config.rateLimit.enabled) return;
  let worst = 0;
  for (const r of rules) {
    const res = hit(r.key, r.limit, r.windowMs);
    if (!res.allowed) worst = Math.max(worst, res.retryAfterSeconds);
  }
  if (worst) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.', undefined, { retry_after_seconds: worst });
}

export function resetRateLimits() {
  windows.clear();
}

// Periodic cleanup so the map does not grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}, 60_000).unref();

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
