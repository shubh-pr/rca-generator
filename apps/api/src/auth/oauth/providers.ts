/**
 * OpenID Connect providers for "Sign in with Google / Microsoft". Each entry is data: endpoints, the
 * issuer rule and how the provider tells us an email address is verified. The flow itself is in flow.ts.
 */
import type { IdentityProvider } from '@prisma/client';
import { config } from '../../config.js';

export type ProviderKey = 'google' | 'microsoft';
export const PROVIDER_KEYS: ProviderKey[] = ['google', 'microsoft'];

/** The claims we read from a verified ID token. */
export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  /** Microsoft: tenant of the account. */
  tid?: string;
  /** Microsoft optional claim: the email's domain is verified by the tenant (xms_edov). */
  xms_edov?: boolean | string;
}

export interface OidcProvider {
  key: ProviderKey;
  db: IdentityProvider;
  label: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  /** Accept this token's issuer (and tenant). */
  issuerOk: (claims: IdClaims) => boolean;
  /** Did the provider verify that this person controls `claims.email`? Only then is the email used to find or create an account. */
  emailVerified: (claims: IdClaims) => boolean;
}

/** Tenant ID of personal Microsoft accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const truthy = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

function google(): OidcProvider {
  const { clientId, clientSecret } = config.oauth.google;
  const fake = config.oauth.testProviderUrl && `${config.oauth.testProviderUrl}/google`;
  const issuers = fake ? [fake] : ['https://accounts.google.com', 'accounts.google.com'];
  return {
    key: 'google',
    db: 'GOOGLE',
    label: 'Google',
    clientId,
    clientSecret,
    authUrl: fake ? `${fake}/authorize` : 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: fake ? `${fake}/token` : 'https://oauth2.googleapis.com/token',
    jwksUrl: fake ? `${fake}/jwks` : 'https://www.googleapis.com/oauth2/v3/certs',
    issuerOk: (c) => issuers.includes(c.iss),
    emailVerified: (c) => !!c.email && truthy(c.email_verified),
  };
}

function microsoft(): OidcProvider {
  const { clientId, clientSecret, tenant } = config.oauth.microsoft;
  const fake = config.oauth.testProviderUrl && `${config.oauth.testProviderUrl}/microsoft`;
  const base = fake ?? `https://login.microsoftonline.com/${tenant}`;
  const issuerBase = fake ?? 'https://login.microsoftonline.com';
  return {
    key: 'microsoft',
    db: 'MICROSOFT',
    label: 'Microsoft',
    clientId,
    clientSecret,
    authUrl: `${base}/oauth2/v2.0/authorize`,
    tokenUrl: `${base}/oauth2/v2.0/token`,
    jwksUrl: `${base}/discovery/v2.0/keys`,
    // The multi-tenant endpoints sign tokens with the account's own tenant in the issuer.
    issuerOk: (c) => {
      if (!c.tid || !GUID.test(c.tid) || c.iss !== `${issuerBase}/${c.tid}/v2.0`) return false;
      if (tenant === 'common') return true;
      if (tenant === 'consumers') return c.tid === MICROSOFT_CONSUMER_TENANT;
      if (tenant === 'organizations') return c.tid !== MICROSOFT_CONSUMER_TENANT;
      return GUID.test(tenant) ? c.tid.toLowerCase() === tenant.toLowerCase() : true;
    },
    // Microsoft does not send email_verified. A personal account's email is its verified sign-in address.
    // For work and school accounts the email attribute can be set by a tenant admin to anything, so it
    // only counts when Entra says the domain is verified (optional claim xms_edov; docs/OAUTH_SETUP.md).
    emailVerified: (c) => !!c.email && (c.tid === MICROSOFT_CONSUMER_TENANT || truthy(c.xms_edov)),
  };
}

export function provider(key: string): OidcProvider | null {
  if (key === 'google') return google();
  if (key === 'microsoft') return microsoft();
  return null;
}

export const isEnabled = (p: OidcProvider | null): p is OidcProvider => !!p?.clientId && !!p.clientSecret;

export const enabledProviders = () => Object.fromEntries(PROVIDER_KEYS.map((k) => [k, isEnabled(provider(k))])) as Record<ProviderKey, boolean>;

export const redirectUri = (p: OidcProvider) => `${config.oauth.redirectBaseUrl}/api/v1/auth/${p.key}/callback`;
