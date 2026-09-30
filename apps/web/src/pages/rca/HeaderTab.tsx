import { useEffect, useMemo } from 'react';
import { api, ApiError } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner } from '../../components/Form';
import { SaveButton, UnsavedBadge, useFormSave } from '../../components/SaveButton';
import { isoToIstInput } from '../../lib/dates';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { HeaderFields, headerToBody, type HeaderValues } from './HeaderFields';
import { useRcaMutation } from './rcaApi';

export function HeaderTab({ rca, onDirty }: { rca: Rca; onDirty: (d: boolean) => void }) {
  const initial = useMemo<HeaderValues>(
    () => ({
      rca_date: rca.rca_date,
      company_name: rca.company_name ?? '',
      project_name: rca.project_name ?? '',
      project_owner_name: rca.project_owner_name ?? '',
      team_leader_name: rca.team_leader_name ?? '',
      ticket_id: rca.ticket_id ?? '',
      severity: rca.severity,
      environment: rca.environment,
      incident_start: isoToIstInput(rca.incident_start),
      detected_at: isoToIstInput(rca.detected_at),
      resolved_at: isoToIstInput(rca.resolved_at),
      prepared_by_name: rca.prepared_by_name ?? '',
      reviewed_by_name: rca.reviewed_by_name ?? '',
    }),
    [rca],
  );
  const form = useDirtyForm(initial);
  useEffect(() => onDirty(form.dirty), [form.dirty, onDirty]);
  const save = useRcaMutation(rca.id, () => api.patch(`/rcas/${rca.id}`, headerToBody(form.values)));
  const editable = rca.permissions.edit && rca.status !== 'CLOSED';
  const errors = save.error instanceof ApiError ? save.error.fields : {};
  const saveAction = useFormSave(save, form.dirty, 'Header', 'Header saved');

  return (
    <div className="space-y-4">
      <h2>Header</h2>
      {!editable && <ReadOnlyNote closed={rca.status === 'CLOSED'} />}
      <ErrorBanner error={save.error} />
      <HeaderFields values={form.values} set={form.set} errors={errors} disabled={!editable} rcaNumber={rca.rca_number} workspaceId={rca.workspace_id} />
      {editable && (
        <div className="flex items-center justify-end gap-3">
          <UnsavedBadge dirty={form.dirty} />
          <button type="button" className="btn-secondary" disabled={!form.dirty} onClick={form.reset}>
            Discard
          </button>
          <SaveButton label="Save header" pending={save.isPending} saved={saveAction.saved} onClick={saveAction.run} />
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
