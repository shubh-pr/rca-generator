import { useEffect, useMemo } from 'react';
import { api, ApiError } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner, Field, TextArea } from '../../components/Form';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { AttachmentsPanel } from './AttachmentsPanel';
import { FollowupsTable } from './FollowupsTable';
import { ReadOnlyNote } from './HeaderTab';
import { useRcaMutation } from './rcaApi';
import { SignoffTable } from './SignoffTable';

export function ClosingTab({ rca, onDirty }: { rca: Rca; onDirty: (d: boolean) => void }) {
  const initial = useMemo(
    () => ({ lessons_well: rca.lessons_well ?? '', lessons_not_well: rca.lessons_not_well ?? '', lessons_key: rca.lessons_key ?? '' }),
    [rca],
  );
  const form = useDirtyForm(initial);
  useEffect(() => onDirty(form.dirty), [form.dirty, onDirty]);
  const save = useRcaMutation(rca.id, () => api.patch(`/rcas/${rca.id}`, form.values));
  const editable = rca.permissions.edit && rca.status !== 'CLOSED';
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2>3.1 Lessons learned</h2>
        {!editable && <ReadOnlyNote closed={rca.status === 'CLOSED'} />}
        <ErrorBanner error={save.error} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="What went well" error={fields.lessons_well} htmlFor="lessons_well">
            <TextArea id="lessons_well" value={form.values.lessons_well} disabled={!editable} onChange={(e) => form.set('lessons_well', e.target.value)} />
          </Field>
          <Field label="What did not go well" error={fields.lessons_not_well} htmlFor="lessons_not_well">
            <TextArea
              id="lessons_not_well"
              value={form.values.lessons_not_well}
              disabled={!editable}
              onChange={(e) => form.set('lessons_not_well', e.target.value)}
            />
          </Field>
          <Field label="Key takeaways" error={fields.lessons_key} htmlFor="lessons_key">
            <TextArea id="lessons_key" value={form.values.lessons_key} disabled={!editable} onChange={(e) => form.set('lessons_key', e.target.value)} />
          </Field>
        </div>
        {editable && (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={!form.dirty} onClick={form.reset}>
              Discard
            </button>
            <button type="button" className="btn-primary" disabled={!form.dirty || save.isPending} onClick={() => save.mutate(undefined)}>
              Save lessons
            </button>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2>3.2 Open risks / follow-ups</h2>
        <FollowupsTable rca={rca} />
      </section>
      <section className="space-y-3">
        <h2>3.3 Attachments</h2>
        <AttachmentsPanel rca={rca} />
      </section>
      <section className="space-y-3">
        <h2>3.4 Sign-off</h2>
        <SignoffTable rca={rca} />
      </section>
    </div>
  );
}
