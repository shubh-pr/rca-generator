import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { useCompanies, useUsers } from '../../api/hooks';
import type { Paged, Project } from '../../api/types';
import { ErrorBanner, Field, Modal, Pagination, Select, TextInput } from '../../components/Form';

export function ProjectsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['projects', { page }],
    queryFn: () => api.get<Paged<Project>>('/projects', { page, page_size: 20 }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1>Projects</h1>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + New project
        </button>
      </div>
      <div className="card">
        <ErrorBanner error={list.error ?? remove.error} />
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Company</th>
              <th>Project Owner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.company.name}</td>
                <td>{p.owner.name}</td>
                <td className="text-right">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-700"
                    onClick={() => confirm(`Delete ${p.name}?`) && remove.mutate(p.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} />}
      </div>
      {editing && <ProjectForm project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const qc = useQueryClient();
  const companies = useCompanies();
  const users = useUsers({ activeOnly: true });
  const [form, setForm] = useState({
    name: project?.name ?? '',
    company_id: project?.company_id ?? '',
    owner_user_id: project?.owner_user_id ?? '',
  });
  const save = useMutation({
    mutationFn: () => (project ? api.patch(`/projects/${project.id}`, form) : api.post('/projects', form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <ErrorBanner error={save.error} />
        <Field label="Name" error={fields.name}>
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Company" error={fields.company_id}>
          <Select
            value={form.company_id}
            onChange={(e) => setForm({ ...form, company_id: e.target.value })}
            options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Project Owner" error={fields.owner_user_id}>
          <Select
            value={form.owner_user_id}
            onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}
            options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          />
        </Field>
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
