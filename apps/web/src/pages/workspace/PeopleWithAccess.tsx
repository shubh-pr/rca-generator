import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { AccessOverview } from '../../api/types';
import { ErrorBanner, TextInput } from '../../components/Form';
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
}

/**
 * Everyone with access in one place (owners): workspace members, the collaborators of every RCA, and
 * pending invitations. RCA collaborators are not workspace members, so they were only visible in each
 * RCA's Share panel before. Loaded fresh on every visit.
 */
export function PeopleWithAccess({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({ queryKey: ['access', workspaceId], queryFn: () => api.get<AccessOverview>(`/workspaces/${workspaceId}/access`), staleTime: 0, refetchOnMount: 'always' });
  const [search, setSearch] = useState('');
  const rows = useMemo<Row[]>(() => {
    const d = q.data;
    if (!d) return [];
    const role = (r: keyof typeof ROLE_LABEL, team: keyof typeof TEAM_LABEL | null) => `${ROLE_LABEL[r]}${team ? ` · ${TEAM_LABEL[team]}` : ''}`;
    return [
      ...d.members.map((m) => ({ key: `m-${m.user_id}`, person: m.name, email: m.email, access: role(m.role, m.team), where: { label: 'Whole workspace' }, status: m.is_primary_owner ? 'Member (primary owner)' : 'Member' })),
      ...d.collaborators.map((c) => ({
        key: `c-${c.rca.id}-${c.user_id}`,
        person: c.name,
        email: c.email,
        access: role(c.role, c.team),
        where: { label: c.rca.rca_number, to: `/rcas/${c.rca.id}` },
        status: c.team && c.section_status ? `Collaborator · ${TEAM_LABEL[c.team]} section ${SECTION_STATUS_LABEL[c.section_status].toLowerCase()}` : 'Collaborator',
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
      })),
    ];
  }, [q.data]);
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
            </tr>
          ))}
          {q.data && shown.length === 0 && (
            <tr>
              <td colSpan={4} className="text-slate-500">
                {needle ? 'Nobody matches.' : 'Nobody else has access yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
