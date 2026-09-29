import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { Team, WorkspaceRole } from '../api/types';
import { ROLE_LABEL, TEAM_LABEL, TEAMS } from '../lib/labels';
import { ErrorBanner, Field, Select, TextInput } from './Form';

const ROLE_HELP: Record<WorkspaceRole, string> = {
  OWNER: 'Full control, including members and deletion',
  EDITOR: 'Edit everything, review, sign, close',
  CONTRIBUTOR: 'Sees everything read-only; edits only their team section',
  VIEWER: 'Read, print and download only',
};

/** Email + role (+ team for contributors). Used for workspace and RCA invitations. */
export function InviteForm({
  roles,
  requireTeam,
  onInvite,
  pending,
  error,
}: {
  roles: WorkspaceRole[];
  requireTeam: boolean;
  onInvite: (v: { email: string; role: WorkspaceRole; team: Team | null }) => void;
  pending: boolean;
  error: unknown;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(roles.includes('EDITOR') ? 'EDITOR' : roles[0]);
  const [team, setTeam] = useState<Team | ''>('');
  const fields = error instanceof ApiError ? error.fields : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onInvite({ email, role, team: role === 'CONTRIBUTOR' && team ? team : null });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-4" data-testid="invite-form">
      <div className="md:col-span-4">
        <ErrorBanner error={error && !Object.keys(fields).length ? error : null} />
      </div>
      <Field label="Email" htmlFor="invite-email" error={fields.email} className="md:col-span-2">
        <TextInput id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role" htmlFor="invite-role" error={fields.role} hint={ROLE_HELP[role]}>
        <Select id="invite-role" placeholder="—" value={role} onChange={(e) => setRole((e.target.value || roles[0]) as WorkspaceRole)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      </Field>
      {role === 'CONTRIBUTOR' ? (
        <Field label={requireTeam ? 'Team section' : 'Team (optional)'} htmlFor="invite-team" error={fields.team}>
          <Select id="invite-team" placeholder={requireTeam ? 'Choose…' : 'Per RCA'} value={team} onChange={(e) => setTeam(e.target.value as Team)} options={TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] }))} />
        </Field>
      ) : (
        <div />
      )}
      <div className="md:col-span-4">
        <button type="submit" className="btn-primary" disabled={pending || !email}>
          Send invitation
        </button>
      </div>
    </form>
  );
}
