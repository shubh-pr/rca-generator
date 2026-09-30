import type { ReactNode } from 'react';
import { usePublicConfig } from './Captcha';

export type OAuthProvider = 'google' | 'microsoft';
export const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

/** Google's standard "G" mark (Google Identity branding guidelines: unmodified colours). */
export function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Microsoft's four-square logo (Microsoft identity platform branding guidelines). */
export function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" width="21" height="21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

// Light-theme buttons as specified by each provider; not restyled with the app's colours.
const GOOGLE_BUTTON =
  'flex h-10 w-full items-center justify-center gap-3 rounded border border-[#747775] bg-white px-3 text-sm font-medium text-[#1F1F1F] hover:bg-[#F8F9FA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4285F4]';
const MICROSOFT_BUTTON =
  'flex h-[41px] w-full items-center justify-center gap-3 border border-[#8C8C8C] bg-white px-3 text-[15px] font-semibold text-[#5E5E5E] hover:bg-[#F3F3F3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00A4EF]';

export function ProviderButton({ provider, href, onClick, disabled, children }: { provider: OAuthProvider; href?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode }) {
  const className = provider === 'google' ? GOOGLE_BUTTON : MICROSOFT_BUTTON;
  const style = provider === 'google' ? { fontFamily: 'Roboto, Arial, sans-serif' } : { fontFamily: '"Segoe UI", Arial, sans-serif' };
  const body = (
    <>
      {provider === 'google' ? <GoogleLogo /> : <MicrosoftLogo />}
      <span>{children ?? `Sign in with ${PROVIDER_LABEL[provider]}`}</span>
    </>
  );
  return href ? (
    <a href={href} className={className} style={style} data-testid={`${provider}-signin`}>
      {body}
    </a>
  ) : (
    <button type="button" className={`${className} disabled:opacity-60`} style={style} onClick={onClick} disabled={disabled} data-testid={`${provider}-connect`}>
      {body}
    </button>
  );
}

/** "Sign in with Google / Microsoft" on the login and sign-up pages: links to the server-side flow. Hidden unless enabled. */
export function OAuthButtons({ next }: { next?: string | null }) {
  const cfg = usePublicConfig();
  const enabled = (['google', 'microsoft'] as const).filter((p) => cfg.data?.[`${p}_enabled`]);
  if (!enabled.length) return null;
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  return (
    <div className="space-y-2">
      {enabled.map((p) => (
        <ProviderButton key={p} provider={p} href={`/api/v1/auth/${p}/start${query}`} />
      ))}
      <p className="text-center text-xs text-slate-500">
        By continuing with {enabled.map((p) => PROVIDER_LABEL[p]).join(' or ')} you accept the Terms of Service and the Privacy Policy. Or use your email:
      </p>
    </div>
  );
}

/** Messages for ?error= (login page) and ?link_error= (settings), with ?provider=. */
export function oauthErrorMessage(code: string, provider: string | null): string {
  const name = PROVIDER_LABEL[provider as OAuthProvider] ?? 'The provider';
  const messages: Record<string, string> = {
    email_not_verified: `${name} did not confirm that this email address is verified, so it cannot be used to sign in or to connect to an existing account. Sign in with your email and password instead, or verify the address with ${name} first.`,
    account_unavailable: 'This account is not available.',
    account_linked_elsewhere: `This email already has a different ${name} account connected. Sign in with that account, or with your email and password.`,
    identity_linked_elsewhere: `This ${name} account is already connected to another user.`,
    provider_already_linked: `A ${name} account is already connected. Disconnect it first to connect a different one.`,
    oauth_cancelled: `${name} sign-in was cancelled.`,
    oauth_state: 'The sign-in link expired. Please try again.',
    oauth_failed: `${name} sign-in failed. Please try again.`,
  };
  return messages[code] ?? 'Sign-in failed. Please try again.';
}
