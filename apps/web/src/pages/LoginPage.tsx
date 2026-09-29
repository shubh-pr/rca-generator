import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { Field, TextInput } from '../components/Form';
import { GOOGLE_ERRORS, GoogleButton } from '../components/GoogleButton';
import { useAuth } from '../lib/auth';
import { homeFor } from '../lib/permissions';
import { AuthCard, Notice } from './auth/AuthCard';

/** Only same-site paths are accepted as a post-login target. */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next ?? homeFor(user)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const me = await login(email, password);
      navigate(next ?? homeFor(me), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else setError('Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Log in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{' '}
          <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-navy underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {params.get('reset') && <Notice tone="success">Password changed. Log in with your new password.</Notice>}
        {params.get('error') && <Notice tone="error">{GOOGLE_ERRORS[params.get('error')!] ?? 'Sign-in failed. Please try again.'}</Notice>}
        <GoogleButton next={next} />
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email" htmlFor="email" error={fields.email}>
          <TextInput id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password}>
          <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <Link to="/forgot-password" className="block text-center text-sm text-navy underline">
          Forgot your password?
        </Link>
      </form>
    </AuthCard>
  );
}
