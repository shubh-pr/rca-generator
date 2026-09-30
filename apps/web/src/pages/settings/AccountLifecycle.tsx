import { useMutation, useQuery } from '@tanstack/react-query';
import { describeEvent, type SecurityEvent, type SecurityRefs } from '../../lib/securityEvents';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, download } from '../../api/client';
import type { Paged } from '../../api/types';
import { ErrorBanner, Field, TextInput } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';


/** Export my data, security log, delete my account (GDPR / DPDP rights). */
export function AccountLifecycle() {
  return (
    <>
      <ExportData />
      <SecurityLog />
      <DeleteAccount />
    </>
  );
}

function ExportData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await download('/me/export', 'rca-dashboard-export.zip');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card space-y-2">
      <h2>Export my data</h2>
      <p className="text-sm text-slate-600">
        A zip file with your profile, workspaces, security log, every RCA in the workspaces you own (as JSON and PDF) and the files you uploaded.
        Large accounts can take a minute.
      </p>
      <ErrorBanner error={error} />
      <button type="button" className="btn-secondary" disabled={busy} onClick={run}>
        {busy ? 'Preparing export…' : 'Download my data'}
      </button>
    </section>
  );
}

/** Kept for existing imports; the descriptions live in lib/securityEvents.ts. */
export const eventLabel = (e: SecurityEvent, refs?: SecurityRefs) => describeEvent(e, refs);

function SecurityLog() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['security-events', page], queryFn: () => api.get<Paged<SecurityEvent> & { refs: SecurityRefs }>('/me/security-events', { page, page_size: 20 }) });
  return (
    <section className="card space-y-2">
      <h2>Security log</h2>
      <ErrorBanner error={q.error} />
      <table className="table" data-testid="security-log">
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Device</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.data.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
              <td data-testid="security-event">
                {describeEvent(e, q.data.refs).label}
                {describeEvent(e, q.data.refs).detail && <div className="text-xs text-slate-500">{describeEvent(e, q.data.refs).detail}</div>}
              </td>
              <td className="max-w-xs truncate text-xs text-slate-500">{String(e.new_value?.user_agent ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.total > 20 && (
        <div className="flex gap-2 text-sm">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          <button type="button" className="btn-ghost" disabled={page * 20 >= q.data.total} onClick={() => setPage(page + 1)}>
            Older
          </button>
        </div>
      )}
    </section>
  );
}

function DeleteAccount() {
  const { user, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const check = useQuery({
    queryKey: ['deletion-check'],
    queryFn: () => api.get<{ blocking_workspaces: { id: string; name: string }[]; grace_days: number }>('/me/deletion-check'),
  });
  const del = useMutation({
    mutationFn: () => api.del('/me', { password: password || undefined, confirm: confirmText }),
    onSuccess: async () => {
      await logout().catch(() => {});
      // Full reload: nothing of the old session survives in memory.
      window.location.replace('/?deleted=1');
    },
  });
  const fields = del.error instanceof ApiError ? del.error.fields : {};
  const blocking = check.data?.blocking_workspaces ?? [];
  return (
    <section className="card space-y-3 border-red-200" data-testid="delete-account">
      <h2 className="text-red-800">Delete my account</h2>
      <p className="text-sm text-slate-600">
        You are logged out and can no longer log in immediately. Your personal workspace, its RCAs and your files are permanently deleted after{' '}
        {check.data?.grace_days ?? 14} days. In workspaces owned by others, your changes stay but are no longer linked to you.
      </p>
      {blocking.length > 0 ? (
        <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          First transfer ownership of, or delete, the shared workspaces you are the only owner of:{' '}
          {blocking.map((w, i) => (
            <span key={w.id}>
              {i > 0 && ', '}
              <Link to={`/workspaces/${w.id}`} className="underline">
                {w.name}
              </Link>
            </span>
          ))}
          .
        </div>
      ) : (
        <>
          <ErrorBanner error={del.error && !Object.keys(fields).length ? del.error : null} />
          {user?.has_password && (
            <Field label="Current password" htmlFor="delete-password" error={fields.password}>
              <TextInput id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Field label="Type DELETE to confirm" htmlFor="delete-confirm" error={fields.confirm}>
            <TextInput id="delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
          <button type="button" className="btn-danger" disabled={confirmText !== 'DELETE' || del.isPending} onClick={() => del.mutate()}>
            Delete my account
          </button>
        </>
      )}
    </section>
  );
}
