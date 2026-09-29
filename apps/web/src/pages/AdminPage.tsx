import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { api } from '../api/client';
import type { Paged } from '../api/types';
import { ErrorBanner, Modal, TextArea, TextInput } from '../components/Form';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/dates';
import { useWorkspace } from '../lib/workspace';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  created_at: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  deleted_at: string | null;
  is_active: boolean;
  is_platform_admin: boolean;
}
interface AdminWorkspace {
  id: string;
  name: string;
  is_personal: boolean;
  owner: { id: string; email: string };
  member_count: number;
  rca_count: number;
}

/** Platform operator console: account metadata and audited support access. No RCA content here. */
export function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { select } = useWorkspace();
  const [q, setQ] = useState('');
  const [supportFor, setSupportFor] = useState<AdminWorkspace | null>(null);
  const users = useQuery({ queryKey: ['admin-users', q], queryFn: () => api.get<Paged<AdminUser>>('/admin/users', { q, page_size: 50 }), enabled: !!user?.is_platform_admin });
  const workspaces = useQuery({ queryKey: ['admin-ws'], queryFn: () => api.get<Paged<AdminWorkspace>>('/admin/workspaces', { page_size: 50 }), enabled: !!user?.is_platform_admin });
  const toggle = useMutation({
    mutationFn: (v: { id: string; disable: boolean }) => api.post(`/admin/users/${v.id}/${v.disable ? 'disable' : 'enable'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  if (!user?.is_platform_admin) return <Navigate to="/" replace />;
  return (
    <div className="space-y-6">
      <div>
        <h1>Operator console</h1>
        <p className="text-sm text-slate-600">Account metadata only. Reading a workspace's RCAs requires an audited, time-limited support access that its owners can see.</p>
      </div>
      <div className="card space-y-3">
        <h2>Users</h2>
        <TextInput placeholder="Search email or name" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <ErrorBanner error={users.error ?? toggle.error} />
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Signed up</th>
              <th>Verified</th>
              <th>Last login</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data?.data.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name} {u.is_platform_admin && <span className="text-xs text-slate-500">(admin)</span>}
                  <div className="text-xs text-slate-500">{u.email}</div>
                </td>
                <td>{formatDateTime(u.created_at)}</td>
                <td>{u.email_verified_at ? 'Yes' : 'No'}</td>
                <td>{formatDateTime(u.last_login_at)}</td>
                <td>{u.deleted_at ? 'Deleted' : u.is_active ? 'Active' : 'Disabled'}</td>
                <td className="text-right">
                  {!u.deleted_at && u.id !== user.id && (
                    <button type="button" className="btn-ghost" onClick={() => confirm(`${u.is_active ? 'Disable' : 'Enable'} ${u.email}?`) && toggle.mutate({ id: u.id, disable: u.is_active })}>
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3">
        <h2>Workspaces</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Owner</th>
              <th>Members</th>
              <th>RCAs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {workspaces.data?.data.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.name} {w.is_personal && <span className="text-xs text-slate-500">(personal)</span>}
                </td>
                <td>{w.owner.email}</td>
                <td>{w.member_count}</td>
                <td>{w.rca_count}</td>
                <td className="text-right">
                  <button type="button" className="btn-ghost" onClick={() => setSupportFor(w)}>
                    Support access…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {supportFor && <SupportModal ws={supportFor} onClose={() => setSupportFor(null)} onGranted={() => select(null)} />}
    </div>
  );
}

function SupportModal({ ws, onClose, onGranted }: { ws: AdminWorkspace; onClose: () => void; onGranted: () => void }) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const grant = useMutation({
    mutationFn: () => api.post('/admin/support-access', { workspace_id: ws.id, reason, minutes }),
    onSuccess: () => {
      onGranted();
      window.location.assign('/rcas');
    },
  });
  return (
    <Modal title={`Support access: ${ws.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Read-only access to this workspace for a limited time. The reason is recorded in the workspace's audit log, visible to its owners.</p>
        <ErrorBanner error={grant.error} />
        <TextArea aria-label="Reason" placeholder="Support ticket or abuse report reference and purpose" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="block text-sm">
          Duration (minutes, max 240)
          <TextInput type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={reason.trim().length < 10 || grant.isPending} onClick={() => grant.mutate()}>
            Start support access
          </button>
        </div>
      </div>
    </Modal>
  );
}
