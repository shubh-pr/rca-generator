import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Me } from '../api/types';
import { ErrorBanner, Field, TextInput } from '../components/Form';
import { SaveButton, UnsavedBadge, useSaveFeedback } from '../components/SaveButton';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/dates';
import { AccountLifecycle } from './settings/AccountLifecycle';
import { ConnectedAccounts } from './settings/ConnectedAccounts';
import { SettingsTabs } from './settings/SettingsTabs';

export function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1>Account settings</h1>
      <SettingsTabs />
      <Profile />
      <Usage />
      <ChangePassword />
      <ConnectedAccounts />
      <Sessions />
      <AccountLifecycle />
    </div>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fb = useSaveFeedback();
  const save = useMutation({
    mutationFn: () => api.patch<Me & { email_change_pending: boolean }>('/me', { name, ...(email !== user?.email ? { email, current_password: password } : {}) }),
    onSuccess: (me) => {
      setUser(me);
      setPassword('');
      fb.succeeded('Profile saved');
      // The email change needs an action, so it stays on the page as well.
      if (me.email_change_pending) setNotice(`We sent a confirmation link to ${email}. Your login email changes after you open it.`);
    },
    onError: (e) => fb.failed(e, 'Profile'),
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const emailChanged = email !== user?.email;
  return (
    <section className="card space-y-3">
      <h2>Profile</h2>
      {notice && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p>}
      <ErrorBanner error={save.error && !Object.keys(fields).length ? save.error : null} />
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setNotice(null);
          save.mutate();
        }}
        className="grid gap-3 md:grid-cols-2"
      >
        <Field label="Name" htmlFor="profile-name" error={fields.name}>
          <TextInput id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="profile-email" error={fields.email} hint={user?.email_verified ? 'Verified' : 'Not verified yet'}>
          <TextInput id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {emailChanged && (
          <Field label="Current password (needed to change the email)" htmlFor="profile-password" error={fields.current_password}>
            <TextInput id="profile-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <div className="flex items-center gap-3 md:col-span-2">
          <SaveButton type="submit" label="Save profile" pending={save.isPending} saved={fb.saved} />
          <UnsavedBadge dirty={name !== (user?.name ?? '') || email !== (user?.email ?? '')} />
        </div>
      </form>
    </section>
  );
}

interface UsageReport {
  storage_bytes_used: number;
  storage_limit_bytes: number;
  rca_count: number;
  rca_limit: number;
}

function Usage() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.get<UsageReport>('/me/usage') });
  if (!q.data) return null;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const bar = (used: number, limit: number) => (
    <div className="h-2 w-full rounded bg-slate-200" role="presentation">
      <div className="h-2 rounded bg-navy" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
    </div>
  );
  return (
    <section className="card space-y-3" data-testid="usage">
      <h2>Usage</h2>
      <p className="text-xs text-slate-500">Counts RCAs and files in the workspaces you own.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-sm">
            RCAs: <strong>{q.data.rca_count}</strong> of {q.data.rca_limit}
          </div>
          {bar(q.data.rca_count, q.data.rca_limit)}
        </div>
        <div>
          <div className="mb-1 text-sm">
            Attachments: <strong>{mb(q.data.storage_bytes_used)}</strong> of {mb(q.data.storage_limit_bytes)}
          </div>
          {bar(q.data.storage_bytes_used, q.data.storage_limit_bytes)}
        </div>
      </div>
    </section>
  );
}

function ChangePassword() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const fb = useSaveFeedback();
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      fb.succeeded('Password changed. Your other devices were signed out.');
    },
    onError: (e) => fb.failed(e, 'Password'),
  });
  const fields = change.error instanceof ApiError ? change.error.fields : {};
  if (user && !user.has_password) return null;
  return (
    <section className="card space-y-3">
      <h2>Change password</h2>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          change.mutate();
        }}
        className="grid gap-3 md:grid-cols-2"
      >
        <Field label="Current password" htmlFor="pw-current" error={fields.current_password}>
          <TextInput id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={fields.new_password} hint="At least 10 characters">
          <TextInput id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <SaveButton type="submit" label="Change password" pending={change.isPending} saved={fb.saved} />
        </div>
      </form>
    </section>
  );
}

interface Session {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

function Sessions() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const list = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ data: Session[] }>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const all = useMutation({ mutationFn: () => api.post('/auth/logout-all'), onSuccess: () => logout() });
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2>Active sessions</h2>
        <button type="button" className="btn-secondary" onClick={() => confirm('Log out on every device, including this one?') && all.mutate()}>
          Log out of all devices
        </button>
      </div>
      <ErrorBanner error={list.error ?? revoke.error} />
      <table className="table" data-testid="sessions">
        <thead>
          <tr>
            <th>Device</th>
            <th>Signed in</th>
            <th>Last active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.data.map((s) => (
            <tr key={s.id}>
              <td className="max-w-xs truncate" title={s.user_agent ?? ''}>
                {describeAgent(s.user_agent)} {s.current && <span className="ml-1 rounded bg-green-100 px-1.5 text-xs font-semibold text-green-800">This device</span>}
              </td>
              <td>{formatDateTime(s.created_at)}</td>
              <td>{formatDateTime(s.last_used_at)}</td>
              <td className="text-right">
                {!s.current && (
                  <button type="button" className="btn-ghost text-red-700" onClick={() => revoke.mutate(s.id)}>
                    Log out
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}
