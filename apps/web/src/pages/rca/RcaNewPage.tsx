import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { Rca } from '../../api/types';
import { ErrorBanner, Field, Select, TextArea } from '../../components/Form';
import { BlamelessNote } from '../../components/Layout';
import { useAuth } from '../../lib/auth';
import { todayIst } from '../../lib/dates';
import { creatableWorkspaces } from '../../lib/permissions';
import { useDirtyForm } from '../../lib/useDirtyForm';
import { useWorkspace } from '../../lib/workspace';
import { HeaderFields, headerToBody, type HeaderValues } from './HeaderFields';

export function RcaNewPage() {
  const { user } = useAuth();
  const { current } = useWorkspace();
  const navigate = useNavigate();
  const workspaces = creatableWorkspaces(user);
  const [workspaceId, setWorkspaceId] = useState(
    (current && workspaces.some((w) => w.id === current.id) ? current.id : workspaces.find((w) => w.is_personal)?.id) ?? workspaces[0]?.id ?? '',
  );
  const initial = useMemo<HeaderValues>(
    () => ({
      rca_date: todayIst(),
      company_name: '',
      project_name: '',
      project_owner_name: user?.name ?? '',
      team_leader_name: user?.name ?? '',
      ticket_id: '',
      severity: '',
      environment: '',
      incident_start: '',
      detected_at: '',
      resolved_at: '',
      prepared_by_name: user?.name ?? '',
      reviewed_by_name: '',
    }),
    [user],
  );
  const form = useDirtyForm(initial);
  const [summary, setSummary] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Rca>('/rcas', { ...headerToBody(form.values), summary, workspace_id: workspaceId }),
    onSuccess: (rca) => navigate(`/rcas/${rca.id}/edit`, { replace: true }),
  });

  if (!user?.email_verified) {
    return (
      <div className="card max-w-xl space-y-2">
        <h1>Verify your email first</h1>
        <p>Creating RCAs needs a verified email address. Check your inbox for the verification link.</p>
        <Link to="/rcas" className="btn-secondary">
          Back to the list
        </Link>
      </div>
    );
  }
  if (workspaces.length === 0) {
    return <ErrorBanner error="You can only view RCAs in the workspaces you belong to." />;
  }
  const errors = create.error instanceof ApiError ? create.error.fields : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <BlamelessNote />
      <h1 className="mb-1">New RCA</h1>
      <p className="mb-4 text-xs text-slate-500" data-testid="required-legend">
        <span className="font-semibold text-red-600">*</span> Required before “Submit for review” (you can add them later)
      </p>
      <div className="card space-y-4">
        <ErrorBanner error={create.error} />
        {workspaces.length > 1 && (
          <Field label="Workspace" error={errors.workspace_id} htmlFor="workspace_id">
            <Select
              id="workspace_id"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Field>
        )}
        <HeaderFields values={form.values} set={form.set} errors={errors} disabled={false} workspaceId={workspaceId} />
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
