import { config } from '../config.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PRODUCT = 'RCA Dashboard';

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string): Rendered {
  const text = [title, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', footer ?? `— ${PRODUCT}`].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:auto">
<h2 style="color:#1F3864">${esc(title)}</h2>
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
${action ? `<p><a href="${esc(action.url)}" style="display:inline-block;background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none">${esc(action.label)}</a></p><p style="font-size:12px;color:#555">Or paste this link into your browser: ${esc(action.url)}</p>` : ''}
<p style="font-size:12px;color:#555">${esc(footer ?? `— ${PRODUCT}`)}</p>
</body></html>`;
  return { subject: title, text, html };
}

/** "1 Oct 2026, 14:05 UTC (19:35 IST)": the app shows IST, the UTC time helps everyone else. */
function when(d: Date) {
  const fmt = (timeZone: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }).format(d);
  return `${fmt('UTC', { day: 'numeric', month: 'short', year: 'numeric' })}, ${fmt('UTC', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} UTC (${fmt('Asia/Kolkata', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} IST)`;
}

const link = (path: string, token: string) => `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;

export const templates = {
  verifyEmail: (name: string, token: string) =>
    layout(
      `Verify your email for ${PRODUCT}`,
      [`Hi ${name},`, 'Confirm your email address to start creating RCAs. The link is valid for 24 hours and can be used once.'],
      { label: 'Verify email', url: link('/verify-email', token) },
      'If you did not sign up, you can ignore this email.',
    ),

  /** Sent instead of a verification mail when someone signs up with an existing address (no enumeration). */
  accountExists: (name: string) =>
    layout(
      `Sign-up attempt for your ${PRODUCT} account`,
      [`Hi ${name},`, 'Someone tried to create an account with this email address, but you already have one.', 'If this was you, log in or reset your password.'],
      { label: 'Reset password', url: `${config.appUrl}/forgot-password` },
      'If this was not you, no action is needed.',
    ),

  resetPassword: (name: string, token: string) =>
    layout(
      `Reset your ${PRODUCT} password`,
      [`Hi ${name},`, 'Use the link below to choose a new password. It is valid for 1 hour and can be used once. All your sessions will be signed out.'],
      { label: 'Choose a new password', url: link('/reset-password', token) },
      'If you did not ask for this, you can ignore this email; your password stays the same.',
    ),

  changeEmail: (name: string, token: string) =>
    layout(
      `Confirm your new email for ${PRODUCT}`,
      [`Hi ${name},`, 'Confirm that this address should become the login email of your account. The link is valid for 24 hours.'],
      { label: 'Confirm new email', url: link('/verify-email', token) },
      'If you did not ask for this, ignore this email.',
    ),

  /** Invitation emails name the inviter and the role only, never RCA content. */
  invitation: (inviterName: string, target: 'workspace' | 'rca', role: string, token: string) =>
    layout(
      `${inviterName} invited you to ${PRODUCT}`,
      [
        `${inviterName} invited you to collaborate on ${target === 'workspace' ? 'a workspace' : 'a root cause analysis'} as ${role.toLowerCase()}.`,
        'Open the link to accept. If you do not have an account yet, you can create one; the invitation is applied automatically. The link is valid for 7 days.',
      ],
      { label: 'Accept invitation', url: link('/invite', token) },
      'If you do not know the sender, ignore this email.',
    ),

  /** A Google or Microsoft account was connected to an existing account (security notice, always sent). */
  identityLinked: (name: string, info: { provider: string; providerEmail: string | null; at: Date; via: 'settings' | 'verified_email'; passwordRemoved: boolean }) =>
    layout(
      `${info.provider} account connected to your ${PRODUCT} account`,
      [
        `Hi ${name},`,
        `A ${info.provider} account${info.providerEmail ? ` (${info.providerEmail})` : ''} was connected to your account on ${when(info.at)}. You can now sign in with it.`,
        info.via === 'settings'
          ? 'It was connected from Account settings while signed in to your account.'
          : `It was connected automatically when someone signed in with ${info.provider}, because ${info.provider} confirmed that they control this email address.`,
        ...(info.passwordRemoved
          ? ['Your email address had not been confirmed before, so the password that was set on this account has been removed and all sessions were signed out. If you want to sign in with a password too, set one in Account settings.']
          : []),
        `If this was not you, disconnect ${info.provider} in Account settings → Connected accounts and change your password straight away.`,
      ],
      { label: 'Review connected accounts', url: `${config.appUrl}/settings` },
      'You receive this email for every new sign-in method on your account. It cannot be turned off.',
    ),

  accountDeleted: (name: string, graceDays: number) =>
    layout(
      `Your ${PRODUCT} account is scheduled for deletion`,
      [
        `Hi ${name},`,
        `Your account has been deactivated. Your personal data and files will be permanently deleted after ${graceDays} days.`,
        'If you did not request this, reply to this email or contact support before then.',
      ],
    ),
};
