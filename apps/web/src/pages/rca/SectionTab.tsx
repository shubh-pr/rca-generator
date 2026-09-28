import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { api, ApiError } from '../../api/client';
import type { CauseCategory, CompletionStatus, Rca, Team, TeamSection } from '../../api/types';
import { SectionBadge } from '../../components/Chips';
import { ErrorBanner, Field, Select, TextArea, TextInput } from '../../components/Form';
import { formatDateTime } from '../../lib/dates';
import { ACTION_STATUS_LABEL, ACTION_STATUSES, CAUSE_CATEGORIES, CAUSE_LABEL, TEAM_LABEL, TEAM_PROMPTS } from '../../lib/labels';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { ActionsTable } from './ActionsTable';
import { ReadOnlyNote } from './HeaderTab';
import { rcaKey, useRcaMutation } from './rcaApi';

const AUTOSAVE_MS = 60_000;

function toForm(s: TeamSection) {
  const why = (n: number) => s.whys.find((w) => w.why_no === n)?.answer ?? '';
  return {
    contributor_name: s.contributor_name ?? '',
    cause_category: (s.cause_category ?? '') as CauseCategory | '',
    escape_analysis: s.escape_analysis ?? '',
    extra_1: s.extra_1 ?? '',
    extra_2: s.extra_2 ?? '',
    prev_process: s.prev_process ?? '',
    prev_automation: s.prev_automation ?? '',
    prev_owner_date: s.prev_owner_date ?? '',
    target_date: s.target_date ?? '',
    actual_date: s.actual_date ?? '',
    completion_status: s.completion_status as CompletionStatus,
    verified_by_name: s.verified_by_name ?? '',
    why_1: why(1),
    why_2: why(2),
    why_3: why(3),
    why_4: why(4),
    why_5: why(5),
  };
}

type SectionForm = ReturnType<typeof toForm>;

function toBody(v: SectionForm, version: number) {
  return {
    version,
    contributor_name: v.contributor_name,
    cause_category: v.cause_category || null,
    escape_analysis: v.escape_analysis,
    extra_1: v.extra_1,
    extra_2: v.extra_2,
    prev_process: v.prev_process,
    prev_automation: v.prev_automation,
    prev_owner_date: v.prev_owner_date,
    target_date: v.target_date || null,
    actual_date: v.actual_date || null,
    completion_status: v.completion_status,
    verified_by_name: v.verified_by_name,
    whys: [1, 2, 3, 4, 5].map((n) => ({ why_no: n, answer: v[`why_${n}` as keyof SectionForm] as string })),
  };
}

export function SectionTab({ rca, team, onDirty }: { rca: Rca; team: Team; onDirty: (d: boolean) => void }) {
  const qc = useQueryClient();
  const section = rca.sections.find((s) => s.team === team)!;
  const initial = useMemo(() => toForm(section), [section]);
  const form = useDirtyForm(initial);
  const v = form.values;
  const labels = TEAM_PROMPTS[team];
  const submitted = section.section_status === 'SUBMITTED';
  const mayEdit = rca.permissions.edit_section[team];
  const editable = mayEdit && !submitted && rca.status !== 'CLOSED';

  useEffect(() => onDirty(form.dirty), [form.dirty, onDirty]);

  const save = useRcaMutation(rca.id, () => api.put<TeamSection>(`/rcas/${rca.id}/sections/${team}`, toBody(v, section.version)));
  const submit = useRcaMutation(rca.id, async () => {
    let version = section.version;
    if (form.dirty) version = (await api.put<TeamSection>(`/rcas/${rca.id}/sections/${team}`, toBody(v, section.version))).version;
    return api.post(`/rcas/${rca.id}/sections/${team}/submit`, { version });
  });
  const unlock = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/sections/${team}/reopen`));

  // Auto-save every 60 seconds while there are unsaved edits (SPEC 6.2).
  const autosave = useRef<() => void>(() => {});
  autosave.current = () => {
    if (editable && form.dirty && !save.isPending && !submit.isPending && !isConflict(save.error)) save.mutate(undefined);
  };
  useEffect(() => {
    const t = setInterval(() => autosave.current(), AUTOSAVE_MS);
    return () => clearInterval(t);
  }, []);

  const err = (save.error ?? submit.error ?? unlock.error) as ApiError | null;
  const fields = err instanceof ApiError ? err.fields : {};
  const conflict = isConflict(save.error) || isConflict(submit.error);

  const reload = async () => {
    save.reset();
    submit.reset();
    await qc.invalidateQueries({ queryKey: rcaKey(rca.id) });
    form.reset();
  };

  return (
    <div className="space-y-6" data-testid={`section-${team}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2>{TEAM_LABEL[team]} section</h2>
          <SectionBadge value={section.section_status} />
          <span className="text-xs text-slate-500">version {section.version}</span>
          {section.submitted_at && <span className="text-xs text-slate-500">submitted {formatDateTime(section.submitted_at)}</span>}
          {section.updated_by_user && (
            <span className="text-xs text-slate-500" data-testid={`last-edited-${team}`}>
              last edited by {section.updated_by_user.name} {formatDateTime(section.updated_at)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {editable && (
            <>
              <button type="button" className="btn-secondary" disabled={!form.dirty || save.isPending} onClick={() => save.mutate(undefined)}>
                {save.isPending ? 'Saving…' : 'Save draft'}
              </button>
              <button type="button" className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate(undefined)}>
                Submit section
              </button>
            </>
          )}
          {submitted && rca.permissions.unlock_section && rca.status === 'DRAFT' && (
            <button type="button" className="btn-secondary" disabled={unlock.isPending} onClick={() => unlock.mutate(undefined)}>
              Unlock
            </button>
          )}
        </div>
      </div>

      {!mayEdit && <ReadOnlyNote text={`Only owners, editors and the ${TEAM_LABEL[team]} contributor can edit this section.`} />}
      {mayEdit && submitted && <ReadOnlyNote text="This section is submitted and locked. An owner or editor can unlock it." />}
      {conflict ? (
        <div className="flex items-center justify-between rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          <span>This section was changed by someone else. Reload to get the latest version (your unsaved edits will be discarded).</span>
          <button type="button" className="btn-secondary" onClick={reload}>
            Reload
          </button>
        </div>
      ) : (
        <ErrorBanner error={err} />
      )}
      {editable && form.dirty && <p className="text-xs text-slate-500">Unsaved changes are auto-saved every 60 seconds.</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Team lead / RCA contributor" error={fields.contributor_name}>
          <TextInput value={v.contributor_name} disabled={!editable} onChange={(e) => form.set('contributor_name', e.target.value)} aria-label="Team lead" />
        </Field>
        <Field label="Cause category" error={fields.cause_category} htmlFor={`${team}-cause`}>
          <Select
            id={`${team}-cause`}
            value={v.cause_category}
            disabled={!editable}
            onChange={(e) => form.set('cause_category', e.target.value as CauseCategory)}
            options={CAUSE_CATEGORIES.map((c) => ({ value: c, label: CAUSE_LABEL[c] }))}
          />
        </Field>
      </div>

      <section className="space-y-2">
        <h3>Cause: 5 Whys</h3>
        {[1, 2, 3, 4, 5].map((n) => {
          const key = `why_${n}` as 'why_1';
          return (
            <Field key={n} label={n === 5 ? 'Why 5 — Root cause' : `Why ${n}`} error={fields[`whys.${n}`]} htmlFor={`${team}-why-${n}`}>
              <TextArea id={`${team}-why-${n}`} rows={2} value={v[key]} disabled={!editable} onChange={(e) => form.set(key, e.target.value)} />
            </Field>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={labels.escape_analysis} error={fields.escape_analysis} htmlFor={`${team}-escape`}>
          <TextArea id={`${team}-escape`} value={v.escape_analysis} disabled={!editable} onChange={(e) => form.set('escape_analysis', e.target.value)} />
        </Field>
        <Field label={labels.extra_1} error={fields.extra_1} htmlFor={`${team}-extra1`}>
          <TextArea id={`${team}-extra1`} value={v.extra_1} disabled={!editable} onChange={(e) => form.set('extra_1', e.target.value)} />
        </Field>
        <Field label={labels.extra_2} error={fields.extra_2} htmlFor={`${team}-extra2`}>
          <TextArea id={`${team}-extra2`} value={v.extra_2} disabled={!editable} onChange={(e) => form.set('extra_2', e.target.value)} />
        </Field>
      </section>

      <section className="space-y-2">
        <h3>Actions</h3>
        {fields.actions && (
          <p className="text-xs text-red-600" role="alert">
            {fields.actions}
          </p>
        )}
        <ActionsTable rca={rca} section={section} />
      </section>

      <section className="space-y-2">
        <h3>Prevention</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Process / checklist" error={fields.prev_process}>
            <TextArea value={v.prev_process} disabled={!editable} onChange={(e) => form.set('prev_process', e.target.value)} />
          </Field>
          <Field label="Automation / tooling" error={fields.prev_automation}>
            <TextArea value={v.prev_automation} disabled={!editable} onChange={(e) => form.set('prev_automation', e.target.value)} />
          </Field>
          <Field label="Owner and target date" error={fields.prev_owner_date}>
            <TextArea value={v.prev_owner_date} disabled={!editable} onChange={(e) => form.set('prev_owner_date', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="space-y-2">
        <h3>Completion</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Target date" error={fields.target_date}>
            <TextInput type="date" value={v.target_date} disabled={!editable} onChange={(e) => form.set('target_date', e.target.value)} />
          </Field>
          <Field label="Actual date" error={fields.actual_date}>
            <TextInput type="date" value={v.actual_date} disabled={!editable} onChange={(e) => form.set('actual_date', e.target.value)} />
          </Field>
          <Field label="Completion status" error={fields.completion_status}>
            <Select
              value={v.completion_status}
              disabled={!editable}
              placeholder="—"
              onChange={(e) => form.set('completion_status', (e.target.value || 'NOT_STARTED') as CompletionStatus)}
              options={ACTION_STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABEL[s] }))}
            />
          </Field>
          <Field label="Verified by" error={fields.verified_by_name}>
            <TextInput value={v.verified_by_name} disabled={!editable} onChange={(e) => form.set('verified_by_name', e.target.value)} aria-label="Verified by" />
          </Field>
        </div>
      </section>
    </div>
  );
}

function isConflict(e: unknown) {
  return e instanceof ApiError && e.status === 409 && e.code === 'VERSION_CONFLICT';
}
