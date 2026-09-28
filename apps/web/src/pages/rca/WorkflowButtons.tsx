import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { Rca, Team } from '../../api/types';
import { Field, Modal, TextArea } from '../../components/Form';
import { TEAM_LABEL, TEAMS } from '../../lib/labels';
import { useRcaMutation } from './rcaApi';

/** Review, send back, close, reopen and delete (SPEC 3.1). The server checks every rule. */
export function WorkflowButtons({ rca }: { rca: Rca }) {
  const p = rca.permissions;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState<'send-back' | 'reopen' | null>(null);
  const submitReview = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/submit-review`));
  const close = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/close`));
  const remove = useMutation({
    mutationFn: () => api.del(`/rcas/${rca.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcas'] });
      navigate('/rcas');
    },
  });
  const error = submitReview.error ?? close.error ?? remove.error;

  return (
    <>
      {rca.status === 'DRAFT' && p.review && (
        <button type="button" className="btn-primary" disabled={submitReview.isPending} onClick={() => submitReview.mutate(undefined)}>
          Submit for review
        </button>
      )}
      {rca.status === 'IN_REVIEW' && p.review && (
        <button type="button" className="btn-secondary" onClick={() => setModal('send-back')}>
          Send back
        </button>
      )}
      {rca.status === 'IN_REVIEW' && p.close && (
        <button type="button" className="btn-primary" disabled={close.isPending} onClick={() => confirm(`Close ${rca.rca_number}?`) && close.mutate(undefined)}>
          Close RCA
        </button>
      )}
      {rca.status === 'CLOSED' && p.reopen && (
        <button type="button" className="btn-secondary" onClick={() => setModal('reopen')}>
          Reopen
        </button>
      )}
      {p.delete && (
        <button type="button" className="btn-ghost text-red-700" onClick={() => confirm(`Delete ${rca.rca_number}? It will be hidden (soft delete).`) && remove.mutate()}>
          Delete
        </button>
      )}
      {error && <WorkflowError error={error} />}
      {modal === 'send-back' && <SendBackModal rca={rca} onClose={() => setModal(null)} />}
      {modal === 'reopen' && <ReopenModal rca={rca} onClose={() => setModal(null)} />}
    </>
  );
}

function WorkflowError({ error }: { error: Error }) {
  const problems = error instanceof ApiError ? (error.details.problems as string[] | undefined) : undefined;
  return (
    <div className="w-full basis-full rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      {problems?.length ? (
        <>
          <strong>{error.message.split(':')[0]}:</strong>
          <ul className="ml-5 list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        error.message
      )}
    </div>
  );
}

function SendBackModal({ rca, onClose }: { rca: Rca; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const send = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/send-back`, { comment, teams }));
  const fields = send.error instanceof ApiError ? send.error.fields : {};
  return (
    <Modal title="Send back for changes" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Comment" error={fields.comment}>
          <TextArea value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Send back comment" />
        </Field>
        <fieldset>
          <legend className="label">Unlock these team sections</legend>
          <div className="flex gap-4">
            {TEAMS.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={teams.includes(t)}
                  onChange={(e) => setTeams(e.target.checked ? [...teams, t] : teams.filter((x) => x !== t))}
                />
                {TEAM_LABEL[t]}
              </label>
            ))}
          </div>
          {fields.teams && <p className="text-xs text-red-600">{fields.teams}</p>}
        </fieldset>
        {send.error && !Object.keys(fields).length && <p className="text-sm text-red-700">{send.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={send.isPending} onClick={() => send.mutate(undefined, { onSuccess: onClose })}>
            Send back
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReopenModal({ rca, onClose }: { rca: Rca; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reopen = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/reopen`, { reason }));
  const fields = reopen.error instanceof ApiError ? reopen.error.fields : {};
  return (
    <Modal title={`Reopen ${rca.rca_number}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The RCA returns to Draft and its version becomes v{rca.version + 1}. Sign-offs are cleared.</p>
        <Field label="Reason (required)" error={fields.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reopen reason" />
        </Field>
        {reopen.error && !Object.keys(fields).length && <p className="text-sm text-red-700">{reopen.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={reopen.isPending} onClick={() => reopen.mutate(undefined, { onSuccess: onClose })}>
            Reopen
          </button>
        </div>
      </div>
    </Modal>
  );
}
