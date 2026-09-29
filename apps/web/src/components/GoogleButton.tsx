import { usePublicConfig } from './Captcha';

/** "Continue with Google": a plain link to the server-side OAuth flow; hidden unless enabled. */
export function GoogleButton({ next }: { next?: string | null }) {
  const cfg = usePublicConfig();
  if (!cfg.data?.google_enabled) return null;
  const href = `/api/v1/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <div className="space-y-2">
      <a href={href} className="btn-secondary w-full" data-testid="google-signin">
        Continue with Google
      </a>
      <p className="text-center text-xs text-slate-500">
        By continuing with Google you accept the Terms of Service and the Privacy Policy. Or use your email:
      </p>
    </div>
  );
}

export const GOOGLE_ERRORS: Record<string, string> = {
  google_email_not_verified: 'Your Google account email is not verified, so it cannot be used to sign in.',
  account_unavailable: 'This account is not available.',
  account_linked_elsewhere: 'This email is already linked to a different Google account.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'The sign-in link expired. Please try again.',
  google_code: 'Google sign-in failed. Please try again.',
  google_token: 'Google sign-in failed. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
};
