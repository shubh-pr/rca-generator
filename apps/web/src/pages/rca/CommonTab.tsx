import { useEffect, useMemo } from 'react';
import { api, ApiError } from '../../api/client';
import type { DetectionMethod, Rca } from '../../api/types';
import { ErrorBanner, Field, Select, TextArea, TextInput } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatMinutes } from '../../lib/dates';
import { DETECTION_LABEL, DETECTION_METHODS } from '../../lib/labels';
import { can } from '../../lib/permissions';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { ReadOnlyNote } from './HeaderTab';
import { useRcaMutation } from './rcaApi';
import { TimelineTable } from './TimelineTable';

export function CommonTab({ rca, onDirty }: { rca: Rca; onDirty: (d: boolean) => void }) {
  const { user } = useAuth();
  const initial = useMemo(
    () => ({
      summary: rca.summary,
      impact_users: rca.impact_users ?? '',
      impact_duration: rca.impact_duration ?? '',
      impact_data_revenue: rca.impact_data_revenue ?? '',
      sla_breached: rca.sla_breached,
      detection_method: (rca.detection_method ?? '') as DetectionMethod | '',
      immediate_fix: rca.immediate_fix ?? '',
      immediate_fix_by: rca.immediate_fix_by ?? '',
    }),
    [rca],
  );
  const form = useDirtyForm(initial);
  const v = form.values;
  useEffect(() => onDirty(form.dirty), [form.dirty, onDirty]);
  const save = useRcaMutation(rca.id, () =>
    api.patch(`/rcas/${rca.id}`, { ...v, detection_method: v.detection_method || null }),
  );
  const editable = can.editCommon(user) && rca.status !== 'CLOSED';
  const errors = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <div className="space-y-6">
      {!editable && <ReadOnlyNote closed={rca.status === 'CLOSED'} />}
      <ErrorBanner error={save.error} />
      <section className="space-y-3">
        <h2>1.1 Problem statement</h2>
        <Field label="Summary (2-3 lines)" error={errors.summary} htmlFor="summary">
          <TextArea id="summary" value={v.summary} disabled={!editable} onChange={(e) => form.set('summary', e.target.value)} />
        </Field>
      </section>
      <section className="space-y-3">
        <h2>1.2 Impact</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Users / clients affected" error={errors.impact_users} htmlFor="impact_users">
            <TextArea id="impact_users" value={v.impact_users} disabled={!editable} onChange={(e) => form.set('impact_users', e.target.value)} />
          </Field>
          <Field label="Data / revenue impact" error={errors.impact_data_revenue} htmlFor="impact_data_revenue">
            <TextArea
              id="impact_data_revenue"
              value={v.impact_data_revenue}
              disabled={!editable}
              onChange={(e) => form.set('impact_data_revenue', e.target.value)}
            />
          </Field>
          <Field label="Impact duration" error={errors.impact_duration} htmlFor="impact_duration">
            <TextInput
              id="impact_duration"
              value={v.impact_duration}
              disabled={!editable}
              onChange={(e) => form.set('impact_duration', e.target.value)}
            />
          </Field>
          <label className="mt-6 flex items-center gap-2">
            <input type="checkbox" checked={v.sla_breached} disabled={!editable} onChange={(e) => form.set('sla_breached', e.target.checked)} />
            <span className="rounded bg-label px-1.5 py-0.5 text-xs font-semibold text-navy">SLA breached</span>
          </label>
        </div>
      </section>
      <section className="space-y-3">
        <h2>1.3 Detection</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Detection method" error={errors.detection_method} htmlFor="detection_method">
            <Select
              id="detection_method"
              value={v.detection_method}
              disabled={!editable}
              onChange={(e) => form.set('detection_method', e.target.value as DetectionMethod)}
              options={DETECTION_METHODS.map((m) => ({ value: m, label: DETECTION_LABEL[m] }))}
            />
          </Field>
          <Field label="Detected at" hint="Set on the Header tab">
            <TextInput value={formatDateTime(rca.detected_at)} disabled readOnly aria-label="Detected at" />
          </Field>
          <Field label="Time to detect" hint="Calculated by the system">
            <TextInput value={formatMinutes(rca.time_to_detect_minutes)} disabled readOnly aria-label="Time to detect (calculated)" />
          </Field>
        </div>
      </section>
      <section className="space-y-3">
        <h2>1.4 Timeline</h2>
        <TimelineTable rca={rca} />
      </section>
      <section className="space-y-3">
        <h2>1.5 Immediate fix</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="What stopped the impact" error={errors.immediate_fix} htmlFor="immediate_fix">
            <TextArea id="immediate_fix" value={v.immediate_fix} disabled={!editable} onChange={(e) => form.set('immediate_fix', e.target.value)} />
          </Field>
          <Field label="Applied by / at" error={errors.immediate_fix_by} htmlFor="immediate_fix_by">
            <TextInput
              id="immediate_fix_by"
              value={v.immediate_fix_by}
              disabled={!editable}
              onChange={(e) => form.set('immediate_fix_by', e.target.value)}
            />
          </Field>
        </div>
      </section>
      {editable && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={!form.dirty} onClick={form.reset}>
            Discard
          </button>
          <button type="button" className="btn-primary" disabled={!form.dirty || save.isPending} onClick={() => save.mutate(undefined)}>
            Save common sections
          </button>
        </div>
      )}
    </div>
  );
}
