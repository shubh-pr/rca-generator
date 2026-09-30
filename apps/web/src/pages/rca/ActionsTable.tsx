import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useParticipants } from '../../api/hooks';
import type { Action, ActionStatus, Rca, TeamSection } from '../../api/types';
import { Select, TextInput } from '../../components/Form';
import { todayIst } from '../../lib/dates';
import { ACTION_STATUS_LABEL, ACTION_STATUSES } from '../../lib/labels';
import { MoveToFollowupButton } from './MoveToFollowupButton';
import { SaveButton, useSaveFeedback } from '../../components/SaveButton';
import { useRcaMutation } from './rcaApi';

interface Row extends Record<string, unknown> {
  action: string;
  owner_id: string;
  due_date: string;
  status: ActionStatus;
  completed_on: string;
}

const toRow = (a?: Action): Row => ({
  action: a?.action ?? '',
  owner_id: a?.owner_id ?? '',
  due_date: a?.due_date ?? '',
  status: a?.status ?? 'NOT_STARTED',
  completed_on: a?.completed_on ?? '',
});

/** Actions table: Action, Owner, Due date, Status; overdue rows red (SPEC 6.2). */
export function ActionsTable({ rca, section }: { rca: Rca; section: TeamSection }) {
  const [adding, setAdding] = useState(false);
  const mayEdit = rca.permissions.edit_section[section.team] && rca.status !== 'CLOSED';
  const locked = section.section_status === 'SUBMITTED';

  return (
    <div className="overflow-x-auto">
      <table className="table" aria-label={`${section.team} actions`}>
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th className="min-w-64">Action</th>
            <th className="w-44">Owner</th>
            <th className="w-40">Due date</th>
            <th className="w-36">Status</th>
            <th className="w-40">Completed on</th>
            <th className="w-44" />
          </tr>
        </thead>
        <tbody>
          {section.actions.map((a) => (
            <ActionRow key={`${a.id}-${JSON.stringify(toRow(a))}`} rca={rca} section={section} action={a} mayEdit={mayEdit} locked={locked} />
          ))}
          {adding && <ActionRow rca={rca} section={section} mayEdit locked={false} onDone={() => setAdding(false)} />}
          {section.actions.length === 0 && !adding && (
            <tr>
              <td colSpan={7} className="text-slate-500">
                No actions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {mayEdit && !locked && !adding && (
        <button type="button" className="btn-secondary mt-2" onClick={() => setAdding(true)}>
          + Add action
        </button>
      )}
    </div>
  );
}

function ActionRow({
  rca,
  section,
  action,
  mayEdit,
  locked,
  onDone,
}: {
  rca: Rca;
  section: TeamSection;
  action?: Action;
  mayEdit: boolean;
  locked: boolean;
  onDone?: () => void;
}) {
  const users = useParticipants(rca.id);
  const [v, setV] = useState<Row>(toRow(action));
  const dirty = JSON.stringify(v) !== JSON.stringify(toRow(action));
  const base = `/rcas/${rca.id}/sections/${section.team}/actions`;
  const body = locked
    ? { status: v.status, completed_on: v.completed_on || null }
    : { ...v, completed_on: v.completed_on || null };
  const save = useRcaMutation(rca.id, () => (action ? api.patch(`${base}/${action.id}`, body) : api.post(base, body)));
  const remove = useRcaMutation(rca.id, () => api.del(`${base}/${action!.id}`));
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const fb = useSaveFeedback();
  const onSave = () =>
    save.mutate(undefined, {
      onSuccess: () => {
        fb.succeeded(action ? 'Action saved' : 'Action added');
        onDone?.();
      },
      onError: (e) => fb.failed(e, 'Action'),
    });
  const textEditable = mayEdit && !locked;
  const statusEditable = mayEdit;
  const overdue = action ? action.is_overdue : !!v.due_date && v.due_date < todayIst() && v.status !== 'COMPLETED';

  return (
    <tr className={overdue ? 'bg-red-50 text-red-800' : ''} data-overdue={overdue || undefined}>
      <td>{action?.seq ?? '—'}</td>
      <td>
        <TextInput aria-label="Action" value={v.action} disabled={!textEditable} onChange={(e) => setV({ ...v, action: e.target.value })} />
        {fields.action && <p className="text-xs text-red-600">{fields.action}</p>}
        {save.error && !Object.keys(fields).length ? <p className="text-xs text-red-600">{save.error.message}</p> : null}
        {action?.followup_id && <p className="text-xs text-slate-500">Moved to follow-ups</p>}
      </td>
      <td>
        <Select
          aria-label="Owner"
          value={v.owner_id}
          disabled={!textEditable}
          onChange={(e) => setV({ ...v, owner_id: e.target.value })}
          options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
        />
        {fields.owner_id && <p className="text-xs text-red-600">{fields.owner_id}</p>}
      </td>
      <td>
        <TextInput
          type="date"
          aria-label="Due date"
          min={rca.rca_date}
          value={v.due_date}
          disabled={!textEditable}
          onChange={(e) => setV({ ...v, due_date: e.target.value })}
        />
        {fields.due_date && <p className="text-xs text-red-600">{fields.due_date}</p>}
        {overdue && <p className="text-xs font-semibold text-red-700">Overdue</p>}
      </td>
      <td>
        <Select
          aria-label="Status"
          placeholder="—"
          value={v.status}
          disabled={!statusEditable}
          onChange={(e) => setV({ ...v, status: (e.target.value || 'NOT_STARTED') as ActionStatus })}
          options={ACTION_STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABEL[s] }))}
        />
      </td>
      <td>
        <TextInput
          type="date"
          aria-label="Completed on"
          value={v.completed_on}
          disabled={!statusEditable}
          onChange={(e) => setV({ ...v, completed_on: e.target.value })}
        />
      </td>
      <td className="text-right whitespace-nowrap">
        {mayEdit && (dirty || !action) && (
          <SaveButton label="Save" pending={save.isPending} saved={fb.saved} onClick={onSave} />
        )}
        {!action && (
          <button type="button" className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
        )}
        {action && textEditable && (
          <button type="button" className="btn-ghost text-red-700" onClick={() => confirm('Delete this action?') && remove.mutate(undefined)}>
            Delete
          </button>
        )}
        {action && !dirty && rca.permissions.manage_followups && <MoveToFollowupButton rca={rca} action={action} />}
      </td>
    </tr>
  );
}
