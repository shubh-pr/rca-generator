/**
 * API client. The access token lives in memory only (never localStorage); the session survives reloads
 * through the httpOnly refresh cookie, exchanged at /auth/refresh with the CSRF double-submit header.
 */
import type { Me } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onUnauthorized: () => void = () => {};
let onSession: (user: Me) => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
export function setSessionHandler(fn: (user: Me) => void) {
  onSession = fn;
}

function csrfToken(): string {
  const m = /(?:^|;\s*)rca_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

export const hasSessionCookie = () => csrfToken() !== '';

let refreshing: Promise<Me | null> | null = null;

/** Get a new access token from the refresh cookie. Single flight: parallel 401s share one refresh. */
export function refreshSession(): Promise<Me | null> {
  refreshing ??= (async () => {
    try {
      if (!hasSessionCookie()) return null;
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() }, credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string; user: Me };
      accessToken = data.access_token;
      onSession(data.user);
      return data.user;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** fetch with the bearer token; on 401 refreshes once and retries. */
async function authedFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 401 && retry && !url.startsWith('/api/v1/auth/')) {
    if (await refreshSession()) return authedFetch(url, init, false);
    onUnauthorized();
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (path === '/auth/logout') headers['X-CSRF-Token'] = csrfToken();
  const res = await authedFetch(`/api/v1${path}${buildQuery(query)}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'ERROR', data?.message ?? res.statusText, data?.fields, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Download a binary endpoint with auth and save it with the server's file name. */
export async function download(path: string, fallbackName: string, query?: Query) {
  const res = await authedFetch(`/api/v1${path}${buildQuery(query)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Download failed');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch text (e.g. the print HTML) with auth. */
export async function fetchText(path: string): Promise<string> {
  const res = await authedFetch(`/api/v1${path}`);
  if (!res.ok) throw new ApiError(res.status, 'ERROR', `Request failed (${res.status})`);
  return res.text();
}
