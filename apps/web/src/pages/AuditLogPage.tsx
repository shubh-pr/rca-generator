import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { AuditEntry, Paged } from '../api/types';
import { ErrorBanner, Pagination, Select, TextInput } from '../components/Form';
import { useWorkspace } from '../lib/workspace';
import { formatDateTime } from '../lib/dates';
import { AuditChange } from './rca/RcaViewPage';

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'SEND_BACK', 'SIGN', 'CLOSE', 'REOPEN', 'EXPORT'];

/** Audit log screen: filter by RCA, user and date (Owner and Admin). */
export function AuditLogPage() {
  const { filter } = useWorkspace();
  const [f, setF] = useState({ rca_number: '', action: '', date_from: '', date_to: '' });
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', f, page, filter.workspace_id],
    queryFn: () => api.get<Paged<AuditEntry>>('/audit', { ...filter, ...f, page, page_size: 50 }),
    placeholderData: (p) => p,
  });
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  return (
    <div>
      <h1 className="mb-1">Audit log</h1>
      <p className="mb-4 text-sm text-slate-600">Changes in the workspaces where you are an owner or editor. Use the workspace switcher to narrow it down.</p>
      <div className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <TextInput placeholder="RCA number" aria-label="RCA number filter" value={f.rca_number} onChange={(e) => set('rca_number', e.target.value)} />
        <Select aria-label="Action filter" placeholder="All actions" value={f.action} onChange={(e) => set('action', e.target.value)} options={ACTIONS.map((a) => ({ value: a, label: a }))} />
        <TextInput type="date" aria-label="From" value={f.date_from} onChange={(e) => set('date_from', e.target.value)} />
        <TextInput type="date" aria-label="To" value={f.date_to} onChange={(e) => set('date_to', e.target.value)} />
      </div>
      <div className="card overflow-x-auto">
        <ErrorBanner error={q.error} />
        <table className="table" data-testid="audit-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>RCA</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.data.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
                <td>{e.user?.name}</td>
                <td className="font-semibold">{e.action}</td>
                <td>{e.entity}</td>
                <td>
                  {e.rca && (
                    <Link to={`/rcas/${e.rca.id}`} className="text-navy underline">
                      {e.rca.rca_number}
                    </Link>
                  )}
                </td>
                <td className="max-w-md text-xs">
                  <AuditChange value={e.new_value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && <Pagination page={page} pageSize={50} total={q.data.total} onPage={setPage} />}
      </div>
    </div>
  );
}
