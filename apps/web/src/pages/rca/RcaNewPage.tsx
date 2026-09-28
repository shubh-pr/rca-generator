import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner, Field, TextArea } from '../../components/Form';
import { BlamelessNote } from '../../components/Layout';
import { useAuth } from '../../lib/auth';
import { todayIst } from '../../lib/dates';
import { can } from '../../lib/permissions';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { HeaderFields, headerToBody, type HeaderValues } from './HeaderFields';

export function RcaNewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const initial = useMemo<HeaderValues>(
    () => ({
      rca_date: todayIst(),
      project_id: '',
      team_leader_id: user?.role === 'RCA_LEAD' ? user.id : '',
      ticket_id: '',
      severity: '',
      environment: '',
      incident_start: '',
      detected_at: '',
      resolved_at: '',
      prepared_by: user?.id ?? '',
      reviewed_by: '',
    }),
    [user],
  );
  const form = useDirtyForm(initial);
  const [summary, setSummary] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Rca>('/rcas', { ...headerToBody(form.values), summary }),
    onSuccess: (rca) => navigate(`/rcas/${rca.id}/edit`, { replace: true }),
  });

  if (!can.createRca(user)) return <Navigate to="/rcas" replace />;
  const errors = create.error instanceof ApiError ? create.error.fields : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <BlamelessNote />
      <h1 className="mb-4">New RCA</h1>
      <div className="card space-y-4">
        <ErrorBanner error={create.error} />
        <HeaderFields values={form.values} set={form.set} errors={errors} disabled={false} />
        <Field label="Problem statement (2-3 lines)" error={errors.summary} htmlFor="summary">
          <TextArea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => navigate('/rcas')}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            Create RCA
          </button>
        </div>
      </div>
    </form>
  );
}
