import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { Member, PendingInvitation, Team, WorkspaceRole } from '../api/types';
import { ErrorBanner, Field, Select, TextInput } from '../components/Form';
import { InviteForm } from '../components/InviteForm';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/dates';
import { ROLE_LABEL, TEAM_LABEL, TEAMS, WORKSPACE_ROLES } from '../lib/labels';
import { useWorkspace } from '../lib/workspace';

/** List of the user's workspaces, and creating a shared one for a team. */
export function WorkspacesPage() {
  const { user, reload } = useAuth();
  const { select } = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/workspaces', { name }),
    onSuccess: async (ws) => {
      await reload();
      select(ws.id);
      navigate(`/workspaces/${ws.id}`);
    },
  });
  return (
    <div className="max-w-3xl space-y-6">
      <h1>Workspaces</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Your role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {user?.workspaces.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.name} {w.is_personal && <span className="text-xs text-slate-500">(personal)</span>}
                </td>
                <td>{ROLE_LABEL[w.role]}</td>
                <td className="text-right">
                  <Link to={`/workspaces/${w.id}`} className="btn-ghost">
                    {w.role === 'OWNER' ? 'Manage' : 'Members'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3">
        <h2>Create a team workspace</h2>
        <p className="text-sm text-slate-600">Share every RCA in a workspace with your team. You can also share a single RCA from its page.</p>
        <ErrorBanner error={create.error} />
        <div className="flex gap-2">
          <TextInput aria-label="Workspace name" placeholder="e.g. Payments team" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="btn-primary whitespace-nowrap" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Create workspace
          </button>
        </div>
      </div>
    </div>
  );
}

/** Members, invitations and settings of one workspace. */
export function WorkspaceDetailPage() {
  const { wid = '' } = useParams();
  const { user, reload } = useAuth();
  const { select } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = user?.workspaces.find((w) => w.id === wid);
  const isOwner = ws?.role === 'OWNER';
  const members = useQuery({ queryKey: ['members', wid], queryFn: () => api.get<{ data: Member[] }>(`/workspaces/${wid}/members`), enabled: !!ws });
  const invitations = useQuery({ queryKey: ['invitations', wid], queryFn: () => api.get<{ data: PendingInvitation[] }>(`/workspaces/${wid}/invitations`), enabled: !!isOwner });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['members', wid] });
    qc.invalidateQueries({ queryKey: ['invitations', wid] });
  };
  const invite = useMutation({ mutationFn: (v: { email: string; role: WorkspaceRole; team: Team | null }) => api.post(`/workspaces/${wid}/invitations`, v), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/workspaces/${wid}/invitations/${id}`), onSuccess: refresh });
  const changeRole = useMutation({ mutationFn: (v: { uid: string; role: WorkspaceRole; team: Team | null }) => api.patch(`/workspaces/${wid}/members/${v.uid}`, { role: v.role, team: v.team }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (uid: string) => api.del(`/workspaces/${wid}/members/${uid}`),
    onSuccess: async (_d, uid) => {
      if (uid === user?.id) {
        await reload();
        select(null);
        navigate('/workspaces');
      } else refresh();
    },
  });
  const transfer = useMutation({ mutationFn: (uid: string) => api.post(`/workspaces/${wid}/transfer`, { user_id: uid }), onSuccess: async () => (await reload(), refresh()) });
  const [newName, setNewName] = useState(ws?.name ?? '');
  const rename = useMutation({ mutationFn: () => api.patch(`/workspaces/${wid}`, { name: newName }), onSuccess: () => reload() });
  const [confirmName, setConfirmName] = useState('');
  const del = useMutation({
    mutationFn: () => api.del(`/workspaces/${wid}`, { confirm_name: confirmName }),
    onSuccess: async () => {
      await reload();
      select(null);
      navigate('/workspaces');
    },
  });

  if (!ws) return <ErrorBanner error="Workspace not found" />;
  const isPrimary = members.data?.data.find((m) => m.user_id === user?.id)?.is_primary_owner;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to="/workspaces" className="text-sm text-navy underline">
          ← Workspaces
        </Link>
        <h1>{ws.name}</h1>
        <p className="text-sm text-slate-600">Your role: {ROLE_LABEL[ws.role]}</p>
      </div>
      <div className="card space-y-3">
        <h2>Members</h2>
        <ErrorBanner error={members.error ?? changeRole.error ?? remove.error ?? transfer.error} />
        <table className="table" data-testid="members">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.data?.data.map((m) => (
              <tr key={m.user_id}>
                <td>
                  {m.name} {m.is_primary_owner && <span className="text-xs text-slate-500">(primary owner)</span>}
                </td>
                <td>{m.email}</td>
                <td>
                  {isOwner && !m.is_primary_owner ? (
                    <div className="flex gap-1">
                      <Select
                        aria-label={`Role of ${m.name}`}
                        placeholder="—"
                        value={m.role}
                        onChange={(e) => changeRole.mutate({ uid: m.user_id, role: e.target.value as WorkspaceRole, team: e.target.value === 'CONTRIBUTOR' ? m.team : null })}
                        options={WORKSPACE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                      />
                      {m.role === 'CONTRIBUTOR' && (
                        <Select
                          aria-label={`Team of ${m.name}`}
                          placeholder="Per RCA"
                          value={m.team ?? ''}
                          onChange={(e) => changeRole.mutate({ uid: m.user_id, role: 'CONTRIBUTOR', team: (e.target.value || null) as Team | null })}
                          options={TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] }))}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      {ROLE_LABEL[m.role]}
                      {m.team ? ` · ${TEAM_LABEL[m.team]}` : ''}
                    </>
                  )}
                </td>
                <td className="text-right whitespace-nowrap">
                  {isPrimary && !m.is_primary_owner && !ws.is_personal && (
                    <button type="button" className="btn-ghost" onClick={() => confirm(`Make ${m.name} the primary owner?`) && transfer.mutate(m.user_id)}>
                      Make primary owner
                    </button>
                  )}
                  {!m.is_primary_owner && (isOwner || m.user_id === user?.id) && (
                    <button
                      type="button"
                      className="btn-ghost text-red-700"
                      onClick={() => confirm(m.user_id === user?.id ? 'Leave this workspace?' : `Remove ${m.name}?`) && remove.mutate(m.user_id)}
                    >
                      {m.user_id === user?.id ? 'Leave' : 'Remove'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <div className="card space-y-3">
          <h2>Invite people</h2>
          <InviteForm
            roles={ws.is_personal ? ['EDITOR', 'CONTRIBUTOR', 'VIEWER'] : WORKSPACE_ROLES}
            requireTeam={false}
            onInvite={(v) => invite.mutate(v)}
            pending={invite.isPending}
            error={invite.error}
          />
          {invite.isSuccess && <p className="text-sm text-green-700">Invitation sent.</p>}
          <PendingInvitations list={invitations.data?.data ?? []} onRevoke={(id) => revoke.mutate(id)} />
        </div>
      )}
      {isOwner && (
        <div className="card space-y-3">
          <h2>Settings</h2>
          <div className="flex gap-2">
            <TextInput aria-label="Workspace name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="button" className="btn-secondary" disabled={!newName.trim() || rename.isPending} onClick={() => rename.mutate()}>
              Rename
            </button>
          </div>
          {!ws.is_personal && (
            <div className="rounded border border-red-200 p-3">
              <h3 className="text-red-800">Delete workspace</h3>
              <p className="text-sm text-slate-600">Deletes every RCA, file and history entry in this workspace. This cannot be undone.</p>
              <ErrorBanner error={del.error} />
              <Field label={`Type "${ws.name}" to confirm`} htmlFor="confirm-ws">
                <TextInput id="confirm-ws" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
              </Field>
              <button type="button" className="btn-danger mt-2" disabled={confirmName !== ws.name || del.isPending} onClick={() => del.mutate()}>
                Delete workspace
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PendingInvitations({ list, onRevoke }: { list: PendingInvitation[]; onRevoke: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <table className="table" data-testid="pending-invitations">
      <thead>
        <tr>
          <th>Pending invitation</th>
          <th>Role</th>
          <th>Expires</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((i) => (
          <tr key={i.id}>
            <td>{i.email}</td>
            <td>
              {ROLE_LABEL[i.role]}
              {i.team ? ` · ${TEAM_LABEL[i.team]}` : ''}
            </td>
            <td>{formatDateTime(i.expires_at)}</td>
            <td className="text-right">
              <button type="button" className="btn-ghost text-red-700" onClick={() => onRevoke(i.id)}>
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
