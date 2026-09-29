import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Centered card used by every public auth page. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-label p-4">
      <Link to="/" className="mb-4 text-lg font-bold text-navy">
        RCA Dashboard
      </Link>
      <div className="card w-full max-w-sm space-y-4">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="text-slate-600">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="mt-4 text-sm text-slate-700">{footer}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children: ReactNode }) {
  const cls = { info: 'bg-blue-50 text-blue-900', success: 'bg-green-50 text-green-900', error: 'bg-red-50 text-red-700' }[tone];
  return (
    <p className={`rounded px-3 py-2 text-sm ${cls}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
