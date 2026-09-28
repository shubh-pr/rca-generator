import { api } from '../../api/client';
import { useParticipants } from '../../api/hooks';
import type { Rca, SignoffRole } from '../../api/types';
import { ErrorBanner, Select } from '../../components/Form';
import { formatDateTime } from '../../lib/dates';
import { SIGNOFF_LABEL, SIGNOFF_ROLES } from '../../lib/labels';
import { useRcaMutation } from './rcaApi';

/**
 * Sign-off rows are labels. An owner or editor can assign each row to a person; unassigned rows can be
 * signed by any owner or editor, so a solo user signs all of them. Signing is possible while IN_REVIEW.
 */
export function SignoffTable({ rca }: { rca: Rca }) {
  const people = useParticipants(rca.id);
  const sign = useRcaMutation(rca.id, (role: SignoffRole) => api.post(`/rcas/${rca.id}/signoffs/${role}`, {}));
  const assign = useRcaMutation(rca.id, ({ role, userId }: { role: SignoffRole; userId: string | null }) =>
    api.put(`/rcas/${rca.id}/signoffs/${role}/assignee`, { user_id: userId }),
  );
  const teamLeadsDone = rca.signoffs.filter((s) => ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'].includes(s.role)).every((s) => s.signed_at);
  const canAssign = rca.permissions.assign_signoff && rca.status !== 'CLOSED';
  return (
    <div className="space-y-2">
      {rca.status !== 'IN_REVIEW' && rca.status !== 'CLOSED' && (
        <p className="text-xs text-slate-500">Sign-off opens when the RCA is submitted for review. You can assign who signs each row now.</p>
      )}
      <ErrorBanner error={sign.error ?? assign.error} />
      <table className="table" aria-label="Sign-off">
        <thead>
          <tr>
            <th>Role</th>
            <th>Assigned to</th>
            <th>Signed by</th>
            <th>Signed at</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {SIGNOFF_ROLES.map((role) => {
            const s = rca.signoffs.find((x) => x.role === role);
            const blockedByOrder = (role === 'PROJECT_OWNER' || role === 'RCA_LEAD') && !teamLeadsDone;
            const canSign = !!s && !s.signed_at && rca.status === 'IN_REVIEW' && rca.permissions.sign[role];
            return (
              <tr key={role} data-testid={`signoff-${role}`}>
                <td className="font-semibold">{SIGNOFF_LABEL[role]}</td>
                <td>
                  {canAssign && !s?.signed_at ? (
                    <Select
                      aria-label={`Assign ${SIGNOFF_LABEL[role]}`}
                      placeholder="Any owner or editor"
                      value={s?.assignee_user_id ?? ''}
                      onChange={(e) => assign.mutate({ role, userId: e.target.value || null })}
                      options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  ) : (
                    (s?.assignee?.name ?? <span className="text-slate-400">Any owner or editor</span>)
                  )}
                </td>
                <td>{s?.user?.name ?? ''}</td>
                <td>{formatDateTime(s?.signed_at)}</td>
                <td className="text-right">
                  {canSign && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={sign.isPending || blockedByOrder}
                      title={blockedByOrder ? 'Dev, QA and Production rows are signed first' : undefined}
                      onClick={() => sign.mutate(role)}
                    >
                      Sign
                    </button>
                  )}
                  {s?.signed_at && <span className="text-xs font-semibold text-green-700">Signed</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
