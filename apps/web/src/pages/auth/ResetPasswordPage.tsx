import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Field, TextInput } from '../../components/Form';
import { AuthCard, Notice } from './AuthCard';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [mismatch, setMismatch] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMismatch(password !== confirm);
    if (password !== confirm) return;
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Reset failed'));
    }
  }

  return (
    <AuthCard title="Choose a new password" footer={<Link to="/forgot-password" className="text-navy underline">Request a new link</Link>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error?.fields.token && <Notice tone="error">{error.fields.token}</Notice>}
        {error && !Object.keys(error.fields).length && <Notice tone="error">{error.message}</Notice>}
        <Field label="New password" htmlFor="password" error={error?.fields.password} hint="At least 10 characters. All your devices will be signed out.">
          <TextInput id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repeat the password" htmlFor="confirm" error={mismatch ? 'The passwords do not match' : undefined}>
          <TextInput id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary w-full">
          Set new password
        </button>
      </form>
    </AuthCard>
  );
}
