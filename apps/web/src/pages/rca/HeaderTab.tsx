import { useEffect, useMemo } from 'react';
import { api, ApiError } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { isoToIstInput } from '../../lib/dates';
import { can } from '../../lib/permissions';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { HeaderFields, headerToBody, type HeaderValues } from './HeaderFields';
import { useRcaMutation } from './rcaApi';

export function HeaderTab({ rca, onDirty }: { rca: Rca; onDirty: (d: boolean) => void }) {
  const { user } = useAuth();
  const initial = useMemo<HeaderValues>(
    () => ({
      rca_date: rca.rca_date,
      project_id: rca.project_id,
      team_leader_id: rca.team_leader_id,
      ticket_id: rca.ticket_id ?? '',
      severity: rca.severity,
      environment: rca.environment,
      incident_start: isoToIstInput(rca.incident_start),
      detected_at: isoToIstInput(rca.detected_at),
      resolved_at: isoToIstInput(rca.resolved_at),
      prepared_by: rca.prepared_by ?? '',
      reviewed_by: rca.reviewed_by ?? '',
    }),
    [rca],
  );
  const form = useDirtyForm(initial);
  useEffect(() => onDirty(form.dirty), [form.dirty, onDirty]);
  const save = useRcaMutation(rca.id, () => api.patch(`/rcas/${rca.id}`, headerToBody(form.values)));
  const editable = can.editCommon(user) && rca.status !== 'CLOSED';
  const errors = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <div className="space-y-4">
      <h2>Header</h2>
      {!editable && <ReadOnlyNote closed={rca.status === 'CLOSED'} />}
      <ErrorBanner error={save.error} />
      <HeaderFields values={form.values} set={form.set} errors={errors} disabled={!editable} rcaNumber={rca.rca_number} />
      {editable && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={!form.dirty} onClick={form.reset}>
            Discard
          </button>
          <button type="button" className="btn-primary" disabled={!form.dirty || save.isPending} onClick={() => save.mutate(undefined)}>
            Save header
          </button>
        </div>
      )}
    </div>
  );
}

export function ReadOnlyNote({ closed, text }: { closed?: boolean; text?: string }) {
  return (
    <p className="rounded bg-slate-100 px-3 py-2 text-xs text-slate-600">
      {text ?? (closed ? 'This RCA is closed. Fields are read-only.' : 'You can view this tab but not edit it.')}
    </p>
  );
}
