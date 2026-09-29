import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth';

export function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-navy">
            RCA Dashboard
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/pricing" className="text-navy">
              Pricing
            </Link>
            {user ? (
              <Link to="/dashboard" className="btn-primary">
                Open the app
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-navy">
                  Log in
                </Link>
                <Link to="/signup" className="btn-primary">
                  Sign up free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4 px-4 py-4 text-sm text-slate-600">
          <span>© {new Date().getFullYear()} RCA Dashboard</span>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/contact">Contact</Link>
          <span className="ml-auto">Only essential cookies are used (sign-in). No tracking.</span>
        </div>
      </footer>
    </div>
  );
}

/** Marker for text the operator must replace before launch (docs/DEPLOY.md, launch checklist). */
export function Replace({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-amber-200 px-1 font-semibold text-amber-900" data-replace-before-launch>
      [REPLACE BEFORE LAUNCH: {children}]
    </mark>
  );
}
