import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { Me, Rca } from '../api/types';
import { ErrorBanner } from '../components/Form';
import { useAuth } from '../lib/auth';

/** First-login welcome: start a real RCA or explore a filled-in example. */
export function WelcomePage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const done = () => api.post<Me>('/me/onboarded').then(setUser);
  const first = useMutation({ mutationFn: done, onSuccess: () => navigate('/rcas/new') });
  const sample = useMutation({
    mutationFn: async () => {
      const rca = await api.post<Rca>('/rcas/sample');
      await done();
      return rca;
    },
    onSuccess: (rca) => navigate(`/rcas/${rca.id}`),
  });
  const skip = useMutation({ mutationFn: done, onSuccess: () => navigate('/dashboard') });
  const verified = !!user?.email_verified;

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="welcome">
      <div>
        <h1 className="text-2xl">Welcome, {user?.name}!</h1>
        <p className="text-slate-600">
          An RCA (root cause analysis) records what happened, why it happened (5 Whys for Dev, QA and Production), what you will change, and who signs it
          off. You can do it all yourself or invite your team later.
        </p>
      </div>
      {!verified && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">Verify your email first (check your inbox); both options below need a verified address.</p>
      )}
      <ErrorBanner error={first.error ?? sample.error ?? skip.error} />
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          className="card text-left transition hover:border-navy hover:shadow disabled:opacity-50"
          disabled={!verified || first.isPending}
          onClick={() => first.mutate()}
        >
          <h2>Create my first RCA</h2>
          <p className="mt-1 text-slate-600">Start from a blank RCA for an incident you are working on.</p>
        </button>
        <button
          type="button"
          className="card text-left transition hover:border-navy hover:shadow disabled:opacity-50"
          disabled={!verified || sample.isPending}
          onClick={() => sample.mutate()}
        >
          <h2>Create a sample RCA</h2>
          <p className="mt-1 text-slate-600">A complete, clearly labelled example you can explore, print and delete.</p>
        </button>
      </div>
      <button type="button" className="btn-ghost" onClick={() => skip.mutate()}>
        Skip for now
      </button>
    </div>
  );
}
