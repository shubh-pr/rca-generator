import { useCallback, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Captcha } from '../../components/Captcha';
import { Field, TextInput } from '../../components/Form';
import { OAuthButtons } from '../../components/OAuthButtons';
import { useAuth } from '../../lib/auth';
import { safeNext } from '../LoginPage';
import { AuthCard, Notice } from './AuthCard';

export function SignupPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', password: '', accept_terms: false });
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((t: string) => setCaptcha(t), []);

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.post('/auth/signup', { ...form, accept_terms: form.accept_terms || undefined, captcha_token: captcha });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        setError(Object.keys(err.fields).length ? null : err.message);
      } else setError('Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your email" subtitle={`We sent a verification link to ${form.email}.`}>
        {next?.startsWith('/invite') && <Notice tone="info">Your invitation is applied automatically when you verify this address.</Notice>}
        <Notice tone="success">Open the link in the email to verify your address. It is valid for 24 hours.</Notice>
        <p className="text-sm text-slate-600">
          You can already log in and look around; creating RCAs needs a verified email.
        </p>
        {next === '/template' && <Notice tone="info">Log in now and your template download starts straight away; you do not need to verify first.</Notice>}
        <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="btn-primary w-full" data-testid="go-login">
          {next === '/template' ? 'Log in to download now' : 'Go to log in'}
        </Link>
        <ResendVerification email={form.email} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Free. Your RCAs stay private to you and the people you invite."
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-navy underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <OAuthButtons next={next} />
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Your name" htmlFor="name" error={fields.name}>
          <TextInput id="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email" error={fields.email}>
          <TextInput id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password} hint="At least 10 characters. Avoid common passwords.">
          <TextInput id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={form.accept_terms} onChange={(e) => setForm({ ...form, accept_terms: e.target.checked })} data-testid="accept-terms" />
          <span>
            I accept the{' '}
            <Link to="/terms" target="_blank" className="text-navy underline">
              Terms of Service
            </Link>{' '}
            and the{' '}
            <Link to="/privacy" target="_blank" className="text-navy underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {fields.accept_terms && <p className="text-xs text-red-600">{fields.accept_terms}</p>}
        <Captcha onToken={onToken} />
        {fields.captcha_token && <p className="text-xs text-red-600">{fields.captcha_token}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}

export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  return (
    <div className="text-sm">
      {state === 'sent' ? (
        <Notice tone="success">{message}</Notice>
      ) : (
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() =>
            api
              .post<{ message: string }>('/auth/resend-verification', { email })
              .then((r) => (setMessage(r.message), setState('sent')))
              .catch((e) => (setMessage(e.message), setState('error')))
          }
        >
          Resend the verification email
        </button>
      )}
      {state === 'error' && <Notice tone="error">{message}</Notice>}
    </div>
  );
}
