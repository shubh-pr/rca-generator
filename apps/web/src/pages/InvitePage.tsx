import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { Team, WorkspaceRole } from '../api/types';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL, TEAM_LABEL } from '../lib/labels';
import { useWorkspace } from '../lib/workspace';
import { AuthCard, Notice } from './auth/AuthCard';

interface Lookup {
  target: 'workspace' | 'rca';
  role: WorkspaceRole;
  team: Team | null;
  inviter_name: string;
  email: string;
  has_account: boolean;
}

/** Invitation link: works for existing users (accept) and new users (sign up; applied after verification). */
export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, reload } = useAuth();
  const { select } = useWorkspace();
  const navigate = useNavigate();
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const lookup = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<Lookup>('/invitations/lookup', { token }), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post<{ workspace_id: string | null; rca_id: string | null }>('/invitations/accept', { token }),
    onSuccess: async (r) => {
      await reload();
      if (r.rca_id) navigate(`/rcas/${r.rca_id}`);
      else {
        select(r.workspace_id);
        navigate('/rcas');
      }
    },
  });

  if (lookup.isLoading) return <AuthCard title="Invitation">Loading…</AuthCard>;
  if (lookup.error || !lookup.data)
    return (
      <AuthCard title="Invitation">
        <Notice tone="error">This invitation is invalid, expired or was already used. Ask for a new one.</Notice>
      </AuthCard>
    );
  const inv = lookup.data;
  const what = `${inv.target === 'workspace' ? 'a workspace' : 'a root cause analysis'} as ${ROLE_LABEL[inv.role].toLowerCase()}${inv.team ? ` (${TEAM_LABEL[inv.team]} section)` : ''}`;
  const acceptError = accept.error instanceof ApiError ? (Object.values(accept.error.fields)[0] ?? accept.error.message) : null;

  return (
    <AuthCard title="You are invited" subtitle={`${inv.inviter_name} invited ${inv.email} to ${what}.`}>
      {user ? (
        <>
          {acceptError && <Notice tone="error">{acceptError}</Notice>}
          <button type="button" className="btn-primary w-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
            Accept invitation
          </button>
          <p className="text-xs text-slate-500">Signed in as {user.email}. The invitation must match this email address.</p>
        </>
      ) : inv.has_account ? (
        <Link to={`/login?next=${encodeURIComponent(here)}`} className="btn-primary w-full">
          Log in to accept
        </Link>
      ) : (
        <>
          <Link to={`/signup?next=${encodeURIComponent(here)}`} className="btn-primary w-full" data-testid="invite-signup">
            Create an account to accept
          </Link>
          <p className="text-xs text-slate-500">Sign up with the invited email address; the invitation is applied as soon as you verify it.</p>
        </>
      )}
    </AuthCard>
  );
}
