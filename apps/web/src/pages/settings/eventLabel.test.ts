import { describe, expect, it } from 'vitest';
import { eventLabel } from './AccountLifecycle';

describe('security log labels', () => {
  it('labels provider links per provider, apart from logins', () => {
    expect(eventLabel({ action: 'IDENTITY_LINK', new_value: { provider: 'google', provider_email: 'a@gmail.com', via: 'verified_email' } })).toEqual({
      label: 'Google account linked',
      detail: 'a@gmail.com · matched by verified email',
    });
    expect(eventLabel({ action: 'IDENTITY_LINK', new_value: { provider: 'microsoft', via: 'settings', password_removed: true } })).toEqual({
      label: 'Microsoft account linked',
      detail: 'from Account settings · unconfirmed password removed',
    });
    expect(eventLabel({ action: 'IDENTITY_UNLINK', new_value: { provider: 'google' } }).label).toBe('Google account disconnected');
    expect(eventLabel({ action: 'LOGIN', new_value: { method: 'microsoft' } }).label).toBe('Logged in with Microsoft');
    expect(eventLabel({ action: 'LOGIN', new_value: {} }).label).toBe('Logged in');
    expect(eventLabel({ action: 'PASSWORD_SET', new_value: null }).label).toBe('Password set');
  });
});
