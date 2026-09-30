import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Rca, TimelineEvent } from '../../api/types';
import { ErrorBanner, TextInput } from '../../components/Form';
import { isoToIstInput, istInputToIso } from '../../lib/dates';
import { SaveButton, useSaveFeedback } from '../../components/SaveButton';
import { useRcaMutation } from './rcaApi';

interface RowValues {
  event_time: string;
  event: string;
  team_or_person: string;
}

const toRow = (e?: TimelineEvent): RowValues => ({
  event_time: isoToIstInput(e?.event_time),
  event: e?.event ?? '',
  team_or_person: e?.team_or_person ?? '',
});

const toBody = (v: RowValues) => ({ event_time: istInputToIso(v.event_time), event: v.event, team_or_person: v.team_or_person });

/** Timeline with "Add row" and inline editing (SPEC 6.2). Times are entered in IST. */
export function TimelineTable({ rca }: { rca: Rca }) {
  const open = rca.status !== 'CLOSED';
  const canAdd = rca.permissions.add_timeline && open;
  const canEdit = rca.permissions.edit_timeline && open;
  const [adding, setAdding] = useState(false);

  return (
    <div className="overflow-x-auto">
      <table className="table" aria-label="Timeline">
        <thead>
          <tr>
            <th className="w-56">Time (IST)</th>
            <th>Event</th>
            <th className="w-48">Team / person</th>
            <th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {rca.timeline.map((e) => (
            <TimelineRow key={`${e.id}-${e.event_time}-${e.event}`} rca={rca} event={e} editable={canEdit} />
          ))}
          {adding && <TimelineRow rca={rca} editable onDone={() => setAdding(false)} />}
          {rca.timeline.length === 0 && !adding && (
            <tr>
              <td colSpan={4} className="text-slate-500">
                No events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {canAdd && !adding && (
        <button type="button" className="btn-secondary mt-2" onClick={() => setAdding(true)}>
          + Add row
        </button>
      )}
    </div>
  );
}

function TimelineRow({ rca, event, editable, onDone }: { rca: Rca; event?: TimelineEvent; editable: boolean; onDone?: () => void }) {
  const [v, setV] = useState(toRow(event));
  const dirty = JSON.stringify(v) !== JSON.stringify(toRow(event));
  const fb = useSaveFeedback();
  const save = useRcaMutation(rca.id, () =>
    event ? api.patch(`/rcas/${rca.id}/timeline/${event.id}`, toBody(v)) : api.post(`/rcas/${rca.id}/timeline`, toBody(v)),
  );
  const remove = useRcaMutation(rca.id, () => api.del(`/rcas/${rca.id}/timeline/${event!.id}`));
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <tr>
      <td>
        <TextInput
          type="datetime-local"
          aria-label="Event time"
          value={v.event_time}
          disabled={!editable}
          onChange={(e) => setV({ ...v, event_time: e.target.value })}
        />
        {fields.event_time && <p className="text-xs text-red-600">{fields.event_time}</p>}
      </td>
      <td>
        <TextInput aria-label="Event" value={v.event} disabled={!editable} onChange={(e) => setV({ ...v, event: e.target.value })} />
        {fields.event && <p className="text-xs text-red-600">{fields.event}</p>}
        {save.error && !Object.keys(fields).length ? <ErrorBanner error={save.error} /> : null}
      </td>
      <td>
        <TextInput
          aria-label="Team or person"
          value={v.team_or_person}
          disabled={!editable}
          onChange={(e) => setV({ ...v, team_or_person: e.target.value })}
        />
      </td>
      <td className="text-right whitespace-nowrap">
        {editable && (dirty || !event) && (
          <SaveButton
            label="Save"
            pending={save.isPending}
            saved={fb.saved}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  fb.succeeded(event ? 'Timeline entry saved' : 'Timeline entry added');
                  onDone?.();
                },
                onError: (e) => fb.failed(e, 'Timeline entry'),
              })
            }
          />
        )}
        {editable && !event && (
          <button type="button" className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
        )}
        {editable && event && (
          <button
            type="button"
            className="btn-ghost text-red-700"
            onClick={() => confirm('Remove this event?') && remove.mutate(undefined)}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
