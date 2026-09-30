import { ROLE_LABEL, TEAM_LABEL } from './labels';

/** Ids stored in the events, resolved by GET /me/security-events (nothing extra is logged for this). */
export interface SecurityRefs {
  rcas: Record<string, string>;
  workspaces: Record<string, string>;
  users: Record<string, { name: string; email: string }>;
  invitations: Record<string, { email: string; role: string; team: string | null; rca_id: string | null; workspace_id: string | null }>;
}

export interface SecurityEvent {
  id?: string;
  action: string;
  entity?: string;
  at?: string;
  workspace_id?: string | null;
  rca_id?: string | null;
  new_value: Record<string, unknown> | null;
}

const EMPTY: SecurityRefs = { rcas: {}, workspaces: {}, users: {}, invitations: {} };
const PROVIDER: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };
const FORMAT: Record<string, string> = { pdf: 'PDF', docx: 'Word', print: 'print view', csv: 'CSV', xlsx: 'Excel' };
const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

function role(r: unknown, team: unknown) {
  const label = ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? s(r);
  const t = TEAM_LABEL[team as keyof typeof TEAM_LABEL];
  return label ? `${label}${t ? ` (${t} section)` : ''}` : undefined;
}

/**
 * One line per event, built only from what the event recorded (plus resolved ids). When a detail was
 * not recorded, the line says less rather than guessing.
 */
export function describeEvent(e: SecurityEvent, refs: SecurityRefs = EMPTY): { label: string; detail?: string } {
  const v = e.new_value ?? {};
  const provider = PROVIDER[s(v.provider) ?? s(v.method) ?? ''];
  const rcaId = s(v.rca_id) ?? e.rca_id ?? undefined;
  const wsId = s(v.workspace_id) ?? e.workspace_id ?? undefined;
  const target = rcaId ? (refs.rcas[rcaId] ?? 'an RCA') : wsId ? `the workspace "${refs.workspaces[wsId] ?? 'deleted workspace'}"` : undefined;
  const person = (id: unknown) => {
    const u = refs.users[s(id) ?? ''];
    return u ? `${u.name} (${u.email})` : 'a person';
  };
  const join = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(' · ') || undefined;

  switch (e.action) {
    case 'SIGNUP':
      return { label: provider ? `Account created with ${provider}` : 'Account created' };
    case 'LOGIN':
      return { label: provider ? `Logged in with ${provider}` : 'Logged in with email and password' };
    case 'LOGIN_FAILED':
      return { label: 'Failed login attempt (wrong password)', detail: v.locked ? 'The account was locked for a while after too many attempts' : undefined };
    case 'LOGOUT':
      return v.remote ? { label: 'Signed out another device', detail: 'From Account settings → Sessions' } : { label: 'Logged out' };
    case 'LOGOUT_ALL':
      return { label: 'Logged out of all devices' };
    case 'EMAIL_VERIFIED':
      return { label: 'Email address verified' };
    case 'EMAIL_CHANGE':
      return { label: `Login email changed${s(v.from) && s(v.to) ? ` from ${v.from} to ${v.to}` : ''}` };
    case 'PASSWORD_CHANGE':
      return { label: 'Password changed', detail: 'Other devices were signed out' };
    case 'PASSWORD_RESET':
      return { label: 'Password reset with an emailed link', detail: 'All sessions were signed out' };
    case 'PASSWORD_SET':
      return { label: 'Password set' };
    case 'IDENTITY_LINK':
      return {
        label: `${provider ?? 'Sign-in'} account linked`,
        detail: join(s(v.provider_email), v.via === 'settings' ? 'from Account settings' : v.via === 'verified_email' ? 'matched by verified email' : null, v.password_removed ? 'unconfirmed password removed' : null),
      };
    case 'IDENTITY_UNLINK':
      return { label: `${provider ?? 'Sign-in'} account disconnected` };
    case 'INVITE':
      return { label: `Invited ${s(v.email) ?? 'someone'}${target ? ` to ${target}` : ''}${role(v.role, v.team) ? ` as ${role(v.role, v.team)}` : ''}` };
    case 'INVITE_ACCEPT':
      return { label: `Accepted an invitation${target ? ` to ${target}` : ''}${role(v.role, v.team) ? ` as ${role(v.role, v.team)}` : ''}` };
    case 'INVITE_ACCEPT_FAILED':
      return { label: `Could not accept an invitation${target ? ` to ${target}` : ''}`, detail: s(v.reason)?.replace(/_/g, ' ') };
    case 'INVITE_REVOKE': {
      const inv = refs.invitations[s(v.invitation_id) ?? ''];
      return { label: `Revoked the invitation${inv ? ` of ${inv.email}` : ''}${target ? ` to ${target}` : ''}${inv && role(inv.role, inv.team) ? ` (${role(inv.role, inv.team)})` : ''}` };
    }
    case 'ROLE_CHANGE':
      if (s(v.target_user_id)) return { label: `${v.action === 'disabled' ? 'Disabled' : 'Enabled'} the account of ${person(v.target_user_id)}`, detail: 'Operator action' };
      return { label: `Changed the access of ${person(v.user_id)}${target ? ` on ${target}` : ''}${role(v.from, null) && role(v.to, v.team) ? `: ${role(v.from, null)} → ${role(v.to, v.team)}` : ''}` };
    case 'MEMBER_REMOVE':
      return { label: `Removed ${person(v.user_id)}${target ? ` from ${target}` : ''}` };
    case 'CREATE':
      return { label: `Created the workspace "${s(v.name) ?? refs.workspaces[wsId ?? ''] ?? '?'}"` };
    case 'DELETE':
      return { label: `Deleted the workspace "${s(v.name) ?? '?'}"`, detail: typeof v.rcas === 'number' ? `${v.rcas} RCA${v.rcas === 1 ? '' : 's'} deleted with it` : undefined };
    case 'EXPORT': {
      const fmt = FORMAT[s(v.format) ?? ''] ?? s(v.format);
      if (v.template === 'blank') return { label: `Downloaded the blank RCA template (${fmt ?? 'Word'})` };
      if (e.entity === 'rca') return { label: `Exported ${refs.rcas[rcaId ?? ''] ?? 'an RCA'}${fmt ? ` as ${fmt}` : ''}`, detail: typeof v.version === 'number' ? `version ${v.version}` : undefined };
      const filters = Object.entries((v.filters ?? {}) as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && x !== '')
        .map(([k, x]) => (k === 'workspace_id' ? `workspace ${refs.workspaces[String(x)] ?? ''}`.trim() : `${k.replace(/_/g, ' ')} ${String(x)}`));
      const count = typeof v.count === 'number' ? `${v.count} ${v.rows === 'actions' ? 'RCA' : 'row'}${v.count === 1 ? '' : 's'}` : undefined;
      return { label: `Exported the RCA ${v.rows === 'actions' ? 'action list' : 'list'}${fmt ? ` as ${fmt}` : ''}${count ? ` (${count})` : ''}`, detail: filters.length ? `Filters: ${filters.join(', ')}` : 'No filters' };
    }
    case 'DATA_EXPORT':
      return { label: 'Downloaded my data (zip)' };
    case 'ACCOUNT_DELETE':
      return { label: 'Account deletion requested', detail: s(v.purge_after) ? `Data is erased on ${new Date(String(v.purge_after)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : undefined };
    case 'SUPPORT_ACCESS':
      return { label: `Used support access${wsId ? ` to the workspace "${refs.workspaces[wsId] ?? '?'}"` : ''}`, detail: 'Operator action' };
    default:
      return { label: e.action };
  }
}
