import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useParticipants } from '../../api/hooks';
import type { Action, Rca } from '../../api/types';
import { ErrorBanner, Field, Modal, Select, TextInput } from '../../components/Form';
import { useRcaMutation } from './rcaApi';

/** Move an open action to Follow-ups with an owner and a date (SPEC 3.1 close rule). */
export function MoveToFollowupButton({ rca, action }: { rca: Rca; action: Action }) {
  const [open, setOpen] = useState(false);
  if (action.status === 'COMPLETED' || action.followup_id || rca.status === 'CLOSED') return null;
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Move to follow-ups
      </button>
      {open && <MoveModal rca={rca} action={action} onClose={() => setOpen(false)} />}
    </>
  );
}

function MoveModal({ rca, action, onClose }: { rca: Rca; action: Action; onClose: () => void }) {
  const users = useParticipants(rca.id);
  const [v, setV] = useState({ risk: action.action, owner_id: action.owner_id, due_date: action.due_date });
  const move = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/followups`, { ...v, action_id: action.id }));
  const fields = move.error instanceof ApiError ? move.error.fields : {};
  return (
    <Modal title="Move action to follow-ups" onClose={onClose}>
      <div className="space-y-3 text-left">
        <ErrorBanner error={move.error} />
        <Field label="Risk / follow-up" error={fields.risk}>
          <TextInput value={v.risk} onChange={(e) => setV({ ...v, risk: e.target.value })} />
        </Field>
        <Field label="Owner" error={fields.owner_id}>
          <Select value={v.owner_id} onChange={(e) => setV({ ...v, owner_id: e.target.value })} options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
        <Field label="Due date" error={fields.due_date}>
          <TextInput type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={move.isPending} onClick={() => move.mutate(undefined, { onSuccess: onClose })}>
            Move
          </button>
        </div>
      </div>
    </Modal>
  );
}
