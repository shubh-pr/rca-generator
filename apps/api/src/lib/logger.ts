/**
 * Structured JSON logs on stdout. Never pass personal data or secrets (emails, names, tokens,
 * passwords, request bodies, query strings) to the logger; ids are fine.
 */
import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

const REDACT = /(password|token|secret|authorization|cookie|email|api[_-]?key)/i;

function clean(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? '[redacted]' : v;
  return out;
}

function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  if (config.env === 'test' && level !== 'error') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...clean(fields) });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => log('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => log('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => log('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => log('error', msg, f),
};
