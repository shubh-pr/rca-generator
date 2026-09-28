import { useRef, useState, type DragEvent } from 'react';
import { api, ApiError, download } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner, TextInput } from '../../components/Form';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';
import { can } from '../../lib/permissions';
import { useRcaMutation } from './rcaApi';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.log', '.csv', '.xlsx', '.docx', '.zip'];

function formatSize(n: number | null) {
  if (n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Attachments with drag and drop (max 10 MB per file) and links (SPEC 6.2). */
export function AttachmentsPanel({ rca }: { rca: Rca }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const editable = can.addAttachment(user) && rca.status !== 'CLOSED';

  const upload = useRcaMutation(rca.id, (file: File) => {
    const fd = new FormData();
    fd.append('description', description);
    fd.append('file', file);
    return api.post(`/rcas/${rca.id}/attachments`, fd);
  });
  const addLink = useRcaMutation(rca.id, () => api.post(`/rcas/${rca.id}/attachments`, { kind: 'LINK', url: link, description }));
  const remove = useRcaMutation(rca.id, (aid: string) => api.del(`/rcas/${rca.id}/attachments/${aid}`));

  const send = (files: FileList | null) => {
    setLocalError(null);
    for (const file of Array.from(files ?? [])) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED.includes(ext)) setLocalError(`${file.name}: type not allowed (${ALLOWED.join(', ')})`);
      else if (file.size > MAX_BYTES) setLocalError(`${file.name} is larger than 10 MB`);
      else upload.mutate(file, { onSuccess: () => setDescription('') });
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (editable) send(e.dataTransfer.files);
  };
  const err = upload.error ?? addLink.error ?? remove.error;

  return (
    <div className="space-y-3">
      <ErrorBanner error={localError ?? (err instanceof ApiError ? Object.values(err.fields)[0] ?? err.message : err)} />
      <table className="table" aria-label="Attachments">
        <thead>
          <tr>
            <th>Attachment</th>
            <th>Description</th>
            <th className="w-44">Added by</th>
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {rca.attachments.map((att) => (
            <tr key={att.id}>
              <td>
                {att.kind === 'LINK' ? (
                  <a href={att.url ?? '#'} target="_blank" rel="noreferrer noopener" className="text-navy underline">
                    {att.url}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="text-navy underline"
                    onClick={() => download(`/rcas/${rca.id}/attachments/${att.id}/download`, att.file_name ?? 'attachment')}
                  >
                    {att.file_name}
                  </button>
                )}
                <span className="ml-2 text-xs text-slate-500">{att.kind === 'FILE' ? formatSize(att.size) : 'link'}</span>
              </td>
              <td>{att.description}</td>
              <td className="text-xs">
                {att.uploader?.name}
                <div className="text-slate-500">{formatDateTime(att.created_at)}</div>
              </td>
              <td className="text-right">
                {rca.status !== 'CLOSED' && can.deleteAttachment(user, att.uploaded_by) && (
                  <button type="button" className="btn-ghost text-red-700" onClick={() => confirm('Remove attachment?') && remove.mutate(att.id)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rca.attachments.length === 0 && (
            <tr>
              <td colSpan={4} className="text-slate-500">
                No attachments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editable && (
        <div className="space-y-2">
          <TextInput placeholder="Description (optional)" aria-label="Attachment description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            className={`cursor-pointer rounded border-2 border-dashed px-4 py-6 text-center text-sm ${over ? 'border-navy bg-label' : 'border-slate-300 text-slate-500'}`}
            data-testid="dropzone"
          >
            {upload.isPending ? 'Uploading…' : 'Drag and drop files here, or click to choose (max 10 MB each)'}
            <input ref={input} type="file" multiple hidden accept={ALLOWED.join(',')} onChange={(e) => send(e.target.files)} data-testid="file-input" />
          </div>
          <div className="flex gap-2">
            <TextInput placeholder="https://… (add a link)" aria-label="Link URL" value={link} onChange={(e) => setLink(e.target.value)} />
            <button
              type="button"
              className="btn-secondary whitespace-nowrap"
              disabled={!link || addLink.isPending}
              onClick={() => addLink.mutate(undefined, { onSuccess: () => (setLink(''), setDescription('')) })}
            >
              Add link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
