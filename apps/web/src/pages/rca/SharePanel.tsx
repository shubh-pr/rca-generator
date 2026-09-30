import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Member, PendingInvitation, Rca, Team, WorkspaceRole } from '../../api/types';
import { ErrorBanner, Modal, Select } from '../../components/Form';
import { InviteForm } from '../../components/InviteForm';
import { useSaveFeedback } from '../../components/SaveButton';
import { ROLE_LABEL, TEAM_LABEL, TEAMS } from '../../lib/labels';
import { PendingInvitations } from '../WorkspacesPage';

/** "Share" dialog: people invited to this RCA only (the workspace's members already have access). */
export function ShareButton({ rca }: { rca: Rca }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Share
      </button>
      {open && <ShareModal rca={rca} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareModal({ rca, onClose }: { rca: Rca; onClose: () => void }) {
  const qc = useQueryClient();
  const manage = rca.permissions.manage_collaborators;
  const collabs = useQuery({ queryKey: ['collaborators', rca.id], queryFn: () => api.get<{ data: Member[] }>(`/rcas/${rca.id}/collaborators`) });
  const invites = useQuery({ queryKey: ['rca-invites', rca.id], queryFn: () => api.get<{ data: PendingInvitation[] }>(`/rcas/${rca.id}/invitations`), enabled: manage });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['collaborators', rca.id] });
    qc.invalidateQueries({ queryKey: ['rca-invites', rca.id] });
    qc.invalidateQueries({ queryKey: ['participants', rca.id] });
  };
  const invite = useMutation({ mutationFn: (v: { email: string; role: WorkspaceRole; team: Team | null }) => api.post(`/rcas/${rca.id}/invitations`, v), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/rcas/${rca.id}/invitations/${id}`), onSuccess: refresh });
  const updateFb = useSaveFeedback();
  const update = useMutation({
    mutationFn: (v: { uid: string; role: WorkspaceRole; team: Team | null }) => api.patch(`/rcas/${rca.id}/collaborators/${v.uid}`, { role: v.role, team: v.team }),
    onSuccess: () => {
      updateFb.succeeded('Access updated');
      refresh();
    },
    onError: (e) => updateFb.failed(e, 'Access'),
  });
  const remove = useMutation({ mutationFn: (uid: string) => api.del(`/rcas/${rca.id}/collaborators/${uid}`), onSuccess: refresh });

  return (
    <Modal title={`Share ${rca.rca_number}`} onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        <p className="text-sm text-slate-600">
          Everyone in the workspace “{rca.workspace.name}” already has access. Invite other people to this RCA only. Contributors see the whole RCA
          read-only and edit only their team section.
        </p>
        <ErrorBanner error={collabs.error ?? update.error ?? remove.error} />
        <table className="table" data-testid="collaborators">
          <thead>
            <tr>
              <th>Person</th>
              <th>Access</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {collabs.data?.data.map((c) => (
              <tr key={c.user_id}>
                <td>
                  {c.name}
                  <div className="text-xs text-slate-500">{c.email}</div>
                </td>
                <td>
                  {manage ? (
                    <div className="flex gap-1">
                      <Select
                        aria-label={`Access of ${c.name}`}
                        placeholder="—"
                        value={c.role}
                        onChange={(e) => update.mutate({ uid: c.user_id, role: e.target.value as WorkspaceRole, team: e.target.value === 'CONTRIBUTOR' ? (c.team ?? 'DEV') : null })}
                        options={(['EDITOR', 'CONTRIBUTOR', 'VIEWER'] as WorkspaceRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                      />
                      {c.role === 'CONTRIBUTOR' && (
                        <Select
                          aria-label={`Team of ${c.name}`}
                          placeholder="—"
                          value={c.team ?? ''}
                          onChange={(e) => update.mutate({ uid: c.user_id, role: 'CONTRIBUTOR', team: (e.target.value || 'DEV') as Team })}
                          options={TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] }))}
                        />
                      )}
                    </div>
                  ) : (
                    `${ROLE_LABEL[c.role]}${c.team ? ` · ${TEAM_LABEL[c.team]}` : ''}`
                  )}
                </td>
                <td className="text-right">
                  {manage && (
                    <button type="button" className="btn-ghost text-red-700" onClick={() => remove.mutate(c.user_id)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {collabs.data?.data.length === 0 && (
              <tr>
                <td colSpan={3} className="text-slate-500">
                  Not shared with anyone outside the workspace.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {manage ? (
          <>
            <InviteForm roles={['EDITOR', 'CONTRIBUTOR', 'VIEWER']} requireTeam onInvite={(v) => invite.mutate(v)} pending={invite.isPending} error={invite.error} />
            {invite.isSuccess && <p className="text-sm text-green-700">Invitation sent.</p>}
            <PendingInvitations list={invites.data?.data ?? []} onRevoke={(id) => revoke.mutate(id)} />
          </>
        ) : (
          <p className="text-xs text-slate-500">Only owners of the workspace can invite people.</p>
        )}
      </div>
    </Modal>
  );
}
