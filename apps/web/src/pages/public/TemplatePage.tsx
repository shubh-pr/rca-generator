import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { download } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { PublicLayout } from './PublicLayout';

const NEXT = '/template';

/**
 * Blank RCA template (editable .docx). A free account is the ask, not payment and not email
 * verification: logged-out visitors go to sign-up and come back here after logging in, where the
 * download starts by itself (docs/BILLING_PLAN.md).
 */
export function TemplatePage() {
  const { user } = useAuth();
  const started = useRef(false);
  const [state, setState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');

  const get = async () => {
    setState('downloading');
    try {
      await download('/templates/rca-blank.docx', 'RCA_Template.docx');
      setState('done');
    } catch {
      setState('error');
    }
  };
  useEffect(() => {
    if (user && !started.current) {
      started.current = true;
      void get();
    }
  }, [user]);

  if (!user) return <Navigate to={`/signup?next=${encodeURIComponent(NEXT)}`} replace />;
  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12" data-testid="template-page">
        <h1 className="text-2xl">Blank RCA template</h1>
        <p className="text-slate-600">The full RCA structure as an editable Word document: header, impact, 5 Whys for Dev, QA and Production, actions, lessons learned and sign-off.</p>
        {state === 'downloading' && <p className="text-slate-600">Preparing your download…</p>}
        {state === 'done' && (
          <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-900" role="status" data-testid="template-started">
            Your download started (RCA_Template.docx).
          </p>
        )}
        {state === 'error' && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            The download did not start. Please try again.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={state === 'downloading'} onClick={() => void get()}>
            Download again
          </button>
          <Link to="/rcas/new" className="btn-primary">
            Fill it in online instead
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
