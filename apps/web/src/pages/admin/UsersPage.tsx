import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { Paged, Team, User, UserRole } from '../../api/types';
import { ErrorBanner, Field, Modal, Pagination, Select, TextInput } from '../../components/Form';
import { ROLE_LABEL, TEAM_LABEL, USER_ROLES } from '../../lib/labels';

const TEAM_OF_ROLE: Partial<Record<UserRole, Team>> = { DEV: 'DEV', QA: 'QA', PROD: 'PROD' };

export function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['users', { page, q }],
    queryFn: () => api.get<Paged<User>>('/users', { page, page_size: 20, q }),
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1>Users</h1>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + New user
        </button>
      </div>
      <div className="card">
        <TextInput placeholder="Search name or email" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="mb-3 max-w-xs" />
        <ErrorBanner error={list.error ?? deactivate.error} />
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Team</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.data.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'text-slate-400'}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>{u.team ? TEAM_LABEL[u.team] : '—'}</td>
                <td>{u.is_active ? 'Yes' : 'No'}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(u)}>
                    Edit
                  </button>
                  {u.is_active && (
                    <button
                      type="button"
                      className="btn-ghost text-red-700"
                      onClick={() => confirm(`Deactivate ${u.name}?`) && deactivate.mutate(u.id)}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} />}
      </div>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'VIEWER') as UserRole,
    password: '',
    is_active: user?.is_active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        role: form.role,
        team: TEAM_OF_ROLE[form.role] ?? null,
        is_active: form.is_active,
      };
      if (form.password || !user) body.password = form.password;
      return user ? api.patch(`/users/${user.id}`, body) : api.post('/users', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Modal title={user ? 'Edit user' : 'New user'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner error={save.error} />
        <Field label="Name" error={fields.name}>
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" error={fields.email}>
          <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role" error={fields.role ?? fields.team} hint="Dev, QA and Production users belong to that team.">
          <Select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            options={USER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </Field>
        <Field label={user ? 'New password (leave blank to keep)' : 'Password'} error={fields.password}>
          <TextInput type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
