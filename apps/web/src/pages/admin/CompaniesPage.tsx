import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { Company, Paged } from '../../api/types';
import { ErrorBanner, Field, Modal, Pagination, TextInput } from '../../components/Form';

export function CompaniesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['companies', { page }],
    queryFn: () => api.get<Paged<Company>>('/companies', { page, page_size: 20 }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/companies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1>Companies</h1>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + New company
        </button>
      </div>
      <div className="card">
        <ErrorBanner error={list.error ?? remove.error} />
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="text-right">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-700"
                    onClick={() => confirm(`Delete ${c.name}?`) && remove.mutate(c.id)}
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
      {editing && <CompanyForm company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CompanyForm({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const save = useMutation({
    mutationFn: () => (company ? api.patch(`/companies/${company.id}`, { name }) : api.post('/companies', { name })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  return (
    <Modal title={company ? 'Edit company' : 'New company'} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <ErrorBanner error={save.error} />
        <Field label="Name" error={fields.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
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
