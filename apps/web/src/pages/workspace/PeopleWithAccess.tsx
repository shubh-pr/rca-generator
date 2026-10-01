import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { AccessOverview } from '../../api/types';
import { ErrorBanner, TextInput } from '../../components/Form';
import { useSaveFeedback } from '../../components/SaveButton';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';
import { ROLE_LABEL, SECTION_STATUS_LABEL, TEAM_LABEL } from '../../lib/labels';

interface Row {
  key: string;
  person: string;
  email: string;
  access: string;
  where: { label: string; to?: string };
  status: string;
  warn?: { text: string; to: string };
  /** The same endpoint the RCA's Share panel / the Members table uses, so the audit trail is identical. */
  action?: { label: 'Revoke' | 'Remove access'; path: string; confirm?: string; done: string; rcaId?: string };
}

/**
 * Everyone with access in one place (owners): workspace members, the collaborators of every RCA, and
 * pending invitations. RCA collaborators are not workspace members, so they were only visible in each
 * RCA's Share panel before. Loaded fresh on every visit.
 */
export function PeopleWithAccess({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({ queryKey: ['access', workspaceId], queryFn: () => api.get<AccessOverview>(`/workspaces/${workspaceId}/access`), staleTime: 0, refetchOnMount: 'always' });
  const [search, setSearch] = useState('');
  const { user } = useAuth();
  const qc = useQueryClient();
  const fb = useSaveFeedback();
  const act = useMutation({
    mutationFn: (a: NonNullable<Row['action']>) => api.del(a.path),
    onSuccess: async (_r, a) => {
      fb.succeeded(a.done);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['access', workspaceId] }),
        qc.invalidateQueries({ queryKey: ['members', workspaceId] }),
        qc.invalidateQueries({ queryKey: ['invitations', workspaceId] }),
        ...(a.rcaId ? [qc.invalidateQueries({ queryKey: ['collaborators', a.rcaId] }), qc.invalidateQueries({ queryKey: ['rca-invites', a.rcaId] })] : []),
      ]);
    },
    onError: (e, a) => fb.failed(e, a.label === 'Revoke' ? 'Revoke' : 'Remove access'),
  });
  const run = (a: NonNullable<Row['action']>) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    act.mutate(a);
  };
  const rows = useMemo<Row[]>(() => {
    const d = q.data;
    if (!d) return [];
    const role = (r: keyof typeof ROLE_LABEL, team: keyof typeof TEAM_LABEL | null) => `${ROLE_LABEL[r]}${team ? ` · ${TEAM_LABEL[team]}` : ''}`;
    return [
      ...d.members.map((m) => ({
        key: `m-${m.user_id}`,
        person: m.name,
        email: m.email,
        access: role(m.role, m.team),
        where: { label: 'Whole workspace' },
        status: m.is_primary_owner ? 'Member (primary owner)' : 'Member',
        // No action on the primary owner or on your own row.
        ...(m.is_primary_owner || m.user_id === user?.id
          ? {}
          : {
              action: {
                label: 'Remove access' as const,
                path: `/workspaces/${workspaceId}/members/${m.user_id}`,
                confirm: `Remove ${m.name} (${m.email}) from this workspace? They lose access to all of its RCAs.`,
                done: `${m.name} removed from the workspace`,
              },
            }),
      })),
      ...d.collaborators.map((c) => ({
        key: `c-${c.rca.id}-${c.user_id}`,
        person: c.name,
        email: c.email,
        access: role(c.role, c.team),
        where: { label: c.rca.rca_number, to: `/rcas/${c.rca.id}` },
        status: c.team && c.section_status ? `Collaborator · ${TEAM_LABEL[c.team]} section ${SECTION_STATUS_LABEL[c.section_status].toLowerCase()}` : 'Collaborator',
        action: {
          label: 'Remove access' as const,
          path: `/rcas/${c.rca.id}/collaborators/${c.user_id}`,
          confirm: `Remove ${c.name} (${c.email}) from ${c.rca.rca_number}?`,
          done: `${c.name} removed from ${c.rca.rca_number}`,
          rcaId: c.rca.id,
        },
        ...(c.nothing_to_edit && c.team
          ? {
              warn: {
                text: c.rca.status !== 'DRAFT' ? `RCA is ${c.rca.status.toLowerCase().replace('_', ' ')}: nothing to edit` : `${TEAM_LABEL[c.team]} section locked: nothing to edit`,
                to: `/rcas/${c.rca.id}/edit?tab=${c.team}&focus=${c.team}-heading`,
              },
            }
          : {}),
      })),
      ...d.pending.map((i) => ({
        key: `i-${i.id}`,
        person: '(invited)',
        email: i.email,
        access: role(i.role, i.team),
        where: i.target ? { label: i.target.rca_number, to: `/rcas/${i.target.rca_id}` } : { label: 'Whole workspace' },
        status: `Invitation pending (expires ${formatDateTime(i.expires_at)})`,
        action: {
          label: 'Revoke' as const,
          path: i.target ? `/rcas/${i.target.rca_id}/invitations/${i.id}` : `/workspaces/${workspaceId}/invitations/${i.id}`,
          done: `Invitation to ${i.email} revoked`,
          rcaId: i.target?.rca_id,
        },
      })),
    ];
  }, [q.data, user?.id, workspaceId]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.person} ${r.email} ${r.where.label}`.toLowerCase().includes(needle)) : rows;

  return (
    <div className="card space-y-3" data-testid="people-with-access">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2>People with access</h2>
          <p className="text-sm text-slate-600">Members of this workspace, people invited to single RCAs, and pending invitations.</p>
        </div>
        <TextInput className="w-64" placeholder="Search name, email or RCA" aria-label="Search people with access" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBanner error={q.error} />
      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Access</th>
            <th>Where</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} data-testid="access-row">
              <td>
                {r.person}
                <div className="text-xs text-slate-500">{r.email}</div>
              </td>
              <td>{r.access}</td>
              <td>
                {r.where.to ? (
                  <Link to={r.where.to} className="text-navy underline">
                    {r.where.label}
                  </Link>
                ) : (
                  r.where.label
                )}
              </td>
              <td className="text-sm">
                {r.status}
                {r.warn && (
                  <div className="mt-1">
                    <Link to={r.warn.to} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 underline" data-testid="nothing-to-edit-badge">
                      {r.warn.text} · Unlock
                    </Link>
                  </div>
                )}
              </td>
              <td className="text-right">
                {r.action && (
                  <button type="button" className="btn-ghost text-red-700" disabled={act.isPending} onClick={() => run(r.action!)}>
                    {r.action.label}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {q.data && shown.length === 0 && (
            <tr>
              <td colSpan={5} className="text-slate-500">
                {needle ? 'Nobody matches.' : 'Nobody else has access yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
