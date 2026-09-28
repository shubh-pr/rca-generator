import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useParticipants } from '../../api/hooks';
import type { Followup, Rca } from '../../api/types';
import { Select, TextInput } from '../../components/Form';
import { useRcaMutation } from './rcaApi';

interface Row extends Record<string, unknown> {
  risk: string;
  owner_id: string;
  due_date: string;
}
const toRow = (f?: Followup): Row => ({ risk: f?.risk ?? '', owner_id: f?.owner_id ?? '', due_date: f?.due_date ?? '' });

export function FollowupsTable({ rca }: { rca: Rca }) {
  const [adding, setAdding] = useState(false);
  const editable = rca.permissions.manage_followups && rca.status !== 'CLOSED';
  return (
    <div className="overflow-x-auto">
      <table className="table" aria-label="Follow-ups">
        <thead>
          <tr>
            <th>Risk / follow-up</th>
            <th className="w-48">Owner</th>
            <th className="w-40">Due date</th>
            <th className="w-36" />
          </tr>
        </thead>
        <tbody>
          {rca.followups.map((f) => (
            <FollowupRow key={`${f.id}-${JSON.stringify(toRow(f))}`} rca={rca} followup={f} editable={editable} />
          ))}
          {adding && <FollowupRow rca={rca} editable onDone={() => setAdding(false)} />}
          {rca.followups.length === 0 && !adding && (
            <tr>
              <td colSpan={4} className="text-slate-500">
                No follow-ups.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editable && !adding && (
        <button type="button" className="btn-secondary mt-2" onClick={() => setAdding(true)}>
          + Add row
        </button>
      )}
    </div>
  );
}

function FollowupRow({ rca, followup, editable, onDone }: { rca: Rca; followup?: Followup; editable: boolean; onDone?: () => void }) {
  const users = useParticipants(rca.id);
  const [v, setV] = useState(toRow(followup));
  const dirty = JSON.stringify(v) !== JSON.stringify(toRow(followup));
  const body = { risk: v.risk, owner_id: v.owner_id || null, due_date: v.due_date || null };
  const save = useRcaMutation(rca.id, () =>
    followup ? api.patch(`/rcas/${rca.id}/followups/${followup.id}`, body) : api.post(`/rcas/${rca.id}/followups`, body),
  );
  const remove = useRcaMutation(rca.id, () => api.del(`/rcas/${rca.id}/followups/${followup!.id}`));
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  return (
    <tr>
      <td>
        <TextInput aria-label="Risk" value={v.risk} disabled={!editable} onChange={(e) => setV({ ...v, risk: e.target.value })} />
        {followup?.action_id && <p className="text-xs text-slate-500">Moved from an open action</p>}
        {(fields.risk || (save.error && !Object.keys(fields).length)) && <p className="text-xs text-red-600">{fields.risk ?? save.error?.message}</p>}
      </td>
      <td>
        <Select
          aria-label="Follow-up owner"
          value={v.owner_id}
          disabled={!editable}
          onChange={(e) => setV({ ...v, owner_id: e.target.value })}
          options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
        />
        {fields.owner_id && <p className="text-xs text-red-600">{fields.owner_id}</p>}
      </td>
      <td>
        <TextInput type="date" aria-label="Follow-up due date" value={v.due_date} disabled={!editable} onChange={(e) => setV({ ...v, due_date: e.target.value })} />
        {fields.due_date && <p className="text-xs text-red-600">{fields.due_date}</p>}
      </td>
      <td className="text-right whitespace-nowrap">
        {editable && (dirty || !followup) && (
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => onDone?.() })}>
            Save
          </button>
        )}
        {!followup && (
          <button type="button" className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
        )}
        {editable && followup && (
          <button type="button" className="btn-ghost text-red-700" onClick={() => confirm('Remove this follow-up?') && remove.mutate(undefined)}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
