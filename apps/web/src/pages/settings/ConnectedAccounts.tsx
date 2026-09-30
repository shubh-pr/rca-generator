import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { Me } from '../../api/types';
import { ErrorBanner, Field, TextInput } from '../../components/Form';
import { oauthErrorMessage, PROVIDER_LABEL, ProviderButton, type OAuthProvider } from '../../components/OAuthButtons';
import { SaveButton, useSaveFeedback } from '../../components/SaveButton';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';

interface Identities {
  has_password: boolean;
  identities: { provider: 'GOOGLE' | 'MICROSOFT'; email: string | null; linked_at: string; last_used_at: string | null }[];
  providers: Record<OAuthProvider, boolean>;
}

const PROVIDERS: OAuthProvider[] = ['google', 'microsoft'];

/** Account settings → Connected accounts: password, Google, Microsoft. The last sign-in method cannot be removed. */
export function ConnectedAccounts() {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['identities'], queryFn: () => api.get<Identities>('/me/identities') });
  const connect = useMutation({
    // The server sets the flow cookie, then the browser goes to the provider and comes back to /settings.
    mutationFn: async (p: OAuthProvider) => window.location.assign((await api.post<{ url: string }>(`/me/identities/${p}/link`)).url),
  });
  const disconnect = useMutation({
    mutationFn: (p: OAuthProvider) => api.del<Identities>(`/me/identities/${p}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['identities'] }),
  });
  const d = q.data;
  const methods = d ? d.identities.length + (d.has_password ? 1 : 0) : 0;
  const linked = params.get('linked');
  const linkError = params.get('link_error');
  const dismiss = () => {
    params.delete('linked');
    params.delete('link_error');
    params.delete('provider');
    setParams(params, { replace: true });
  };

  return (
    <section className="card space-y-3" aria-labelledby="connected-accounts" data-testid="connected-accounts">
      <h2 id="connected-accounts">Connected accounts</h2>
      <p className="text-sm text-slate-600">Ways you can sign in. Keep at least one; you cannot disconnect the last one.</p>
      {linked && (
        <p className="flex justify-between rounded bg-green-50 px-3 py-2 text-sm text-green-900" role="status">
          {PROVIDER_LABEL[linked as OAuthProvider] ?? 'The account'} is connected. You can now sign in with it.
          <button type="button" className="underline" onClick={dismiss}>
            Dismiss
          </button>
        </p>
      )}
      {linkError && (
        <p className="flex justify-between gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-testid="link-error">
          {oauthErrorMessage(linkError, params.get('provider'))}
          <button type="button" className="underline" onClick={dismiss}>
            Dismiss
          </button>
        </p>
      )}
      <ErrorBanner error={q.error ?? connect.error ?? disconnect.error} />
      {d && (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          <li className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="method-password">
            <div>
              <div className="font-semibold">Email and password</div>
              <div className="text-xs text-slate-500">{d.has_password ? 'Password set' : 'No password yet'}</div>
            </div>
          </li>
          {PROVIDERS.filter((p) => d.providers[p] || d.identities.some((i) => i.provider === p.toUpperCase())).map((p) => {
            const identity = d.identities.find((i) => i.provider === p.toUpperCase());
            const last = !!identity && methods <= 1;
            return (
              <li key={p} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={`method-${p}`}>
                <div>
                  <div className="font-semibold">{PROVIDER_LABEL[p]}</div>
                  <div className="text-xs text-slate-500">
                    {identity ? `Connected${identity.email ? ` as ${identity.email}` : ''} on ${formatDateTime(identity.linked_at)}` : 'Not connected'}
                  </div>
                </div>
                {identity ? (
                  <div className="text-right">
                    <button type="button" className="btn-secondary" disabled={last || disconnect.isPending} onClick={() => disconnect.mutate(p)}>
                      Disconnect {PROVIDER_LABEL[p]}
                    </button>
                    {last && <p className="mt-1 max-w-xs text-xs text-slate-500">This is your only way to sign in. Set a password below or connect another account first.</p>}
                  </div>
                ) : (
                  d.providers[p] && (
                    <div className="w-64">
                      <ProviderButton provider={p} onClick={() => connect.mutate(p)} disabled={connect.isPending}>
                        Connect {PROVIDER_LABEL[p]}
                      </ProviderButton>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {d && !d.has_password && (
        <SetPassword
          onDone={async () => {
            await qc.invalidateQueries({ queryKey: ['identities'] });
            setUser(await api.get<Me>('/me'));
          }}
        />
      )}
    </section>
  );
}

function SetPassword({ onDone }: { onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const fb = useSaveFeedback();
  const set = useMutation({
    mutationFn: () => api.post('/me/password', { new_password: password }),
    onSuccess: async () => {
      fb.succeeded('Password set. You can now also sign in with your email address.');
      await onDone();
    },
    onError: (e) => fb.failed(e, 'Password'),
  });
  const fields = set.error instanceof ApiError ? set.error.fields : {};
  return (
    <form
      className="space-y-2 rounded border border-slate-200 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        set.mutate();
      }}
    >
      <h3>Set a password</h3>
      <p className="text-sm text-slate-600">Optional. With a password you can also sign in with your email address.</p>
      <ErrorBanner error={set.error && !Object.keys(fields).length ? set.error : null} />
      <Field label="New password" htmlFor="set-password" error={fields.new_password} hint="At least 10 characters">
        <TextInput id="set-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <SaveButton type="submit" label="Set password" pending={set.isPending} saved={fb.saved} disabled={!password} />
    </form>
  );
}
