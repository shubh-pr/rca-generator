import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { Field, TextInput } from '../components/Form';
import { useAuth } from '../lib/auth';
import { homeFor } from '../lib/permissions';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const me = await login(email, password);
      navigate(homeFor(me), { replace: true });
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
    <div className="flex min-h-screen items-center justify-center bg-label p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4" noValidate>
        <div>
          <h1>RCA Admin Dashboard</h1>
          <p className="text-slate-600">Sign in with your email and password.</p>
        </div>
        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-red-700" role="alert">
            {error}
          </p>
        )}
        <Field label="Email" htmlFor="email" error={fields.email}>
          <TextInput id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password}>
          <TextInput
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
