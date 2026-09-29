import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Captcha } from '../../components/Captcha';
import { Field, TextInput } from '../../components/Form';
import { AuthCard, Notice } from './AuthCard';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const onToken = useCallback((t: string) => setCaptcha(t), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setMessage((await api.post<{ message: string }>('/auth/forgot-password', { email, captcha_token: captcha })).message);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Request failed'));
    }
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your email and we will send you a reset link." footer={<Link to="/login" className="text-navy underline">Back to log in</Link>}>
      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && !Object.keys(error.fields).length && <Notice tone="error">{error.message}</Notice>}
          <Field label="Email" htmlFor="email" error={error?.fields.email}>
            <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Captcha onToken={onToken} />
          {error?.fields.captcha_token && <p className="text-xs text-red-600">{error.fields.captcha_token}</p>}
          <button type="submit" className="btn-primary w-full">
            Send reset link
          </button>
        </form>
      )}
    </AuthCard>
  );
}
