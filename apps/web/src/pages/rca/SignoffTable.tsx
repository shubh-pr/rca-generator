import { api } from '../../api/client';
import type { Rca, SignoffRole } from '../../api/types';
import { ErrorBanner } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';
import { SIGNOFF_LABEL, SIGNOFF_ROLES } from '../../lib/labels';
import { can } from '../../lib/permissions';
import { useRcaMutation } from './rcaApi';

/** Each person clicks Sign for their own role (SPEC 6.2). Signing is possible while IN_REVIEW. */
export function SignoffTable({ rca }: { rca: Rca }) {
  const { user } = useAuth();
  const sign = useRcaMutation(rca.id, (role: SignoffRole) => api.post(`/rcas/${rca.id}/signoffs/${role}`, {}));
  const teamLeadsDone = rca.signoffs.filter((s) => ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'].includes(s.role)).every((s) => s.signed_at);
  return (
    <div className="space-y-2">
      {rca.status !== 'IN_REVIEW' && rca.status !== 'CLOSED' && (
        <p className="text-xs text-slate-500">Sign-off opens when the RCA is submitted for review.</p>
      )}
      <ErrorBanner error={sign.error} />
      <table className="table" aria-label="Sign-off">
        <thead>
          <tr>
            <th>Role</th>
            <th>Name</th>
            <th>Signed at</th>
            <th>Comment</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {SIGNOFF_ROLES.map((role) => {
            const s = rca.signoffs.find((x) => x.role === role);
            const blockedByOrder = (role === 'PROJECT_OWNER' || role === 'RCA_LEAD') && !teamLeadsDone;
            const canSign = !s?.signed_at && rca.status === 'IN_REVIEW' && can.signoff(user, role);
            return (
              <tr key={role} data-testid={`signoff-${role}`}>
                <td className="font-semibold">{SIGNOFF_LABEL[role]}</td>
                <td>{s?.user?.name ?? ''}</td>
                <td>{formatDateTime(s?.signed_at)}</td>
                <td>{s?.comment}</td>
                <td className="text-right">
                  {canSign && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={sign.isPending || blockedByOrder}
                      title={blockedByOrder ? 'Dev, QA and Production leads sign first' : undefined}
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
