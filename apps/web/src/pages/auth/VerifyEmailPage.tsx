import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { AuthCard, Notice } from './AuthCard';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { user, reload } = useAuth();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'changed' | 'error'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post<{ verified: boolean; email_changed?: boolean }>('/auth/verify-email', { token })
      .then((r) => {
        setState(r.email_changed ? 'changed' : 'ok');
        if (user) reload().catch(() => {});
      })
      .catch((e) => {
        setState('error');
        setMessage(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Verification failed');
      });
  }, [token, user, reload]);

  return (
    <AuthCard title="Email verification">
      {state === 'working' && <p className="text-slate-600">Checking your link…</p>}
      {state === 'ok' && <Notice tone="success">Your email is verified. You can now create RCAs.</Notice>}
      {state === 'changed' && <Notice tone="success">Your login email has been changed.</Notice>}
      {state === 'error' && <Notice tone="error">{message}</Notice>}
      {state !== 'working' && (
        <Link to={user ? '/dashboard' : '/login'} className="btn-primary w-full" data-testid="verify-continue">
          {user ? 'Continue' : 'Log in'}
        </Link>
      )}
    </AuthCard>
  );
}
