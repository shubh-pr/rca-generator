/**
 * Fake OpenID Connect provider for the Playwright tests: stands in for Google and Microsoft so no test
 * ever talks to the real services. The API points at it with OAUTH_TEST_PROVIDER_URL (refused in
 * production). It implements what the app relies on: the authorization page, PKCE (S256) at the token
 * endpoint, client authentication, the redirect URI check, RS256 ID tokens with nonce, and JWKS.
 *
 *   GET  /{google|microsoft}/authorize            sign-in page with a form (email, name, verified / account type)
 *   GET  /{google|microsoft}/oauth2/v2.0/authorize (Microsoft path layout)
 *   POST .../token, GET .../jwks | .../discovery/v2.0/keys
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';

const PORT = Number(process.env.MOCK_OIDC_PORT ?? 4200);
const BASE = `http://localhost:${PORT}`;
const CLIENTS = {
  google: { id: process.env.GOOGLE_CLIENT_ID ?? 'e2e-google-client', secret: process.env.GOOGLE_CLIENT_SECRET ?? 'e2e-google-secret' },
  microsoft: { id: process.env.MICROSOFT_CLIENT_ID ?? 'e2e-microsoft-client', secret: process.env.MICROSOFT_CLIENT_SECRET ?? 'e2e-microsoft-secret' },
};
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const WORK_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mock-kid', alg: 'RS256', use: 'sig' };
const codes = new Map();

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function idToken(claims) {
  const input = `${b64url({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })}.${b64url(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function authorizePage(p, q) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge', 'code_challenge_method'].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('');
  const extra =
    p === 'google'
      ? '<label><input type="checkbox" name="email_verified" checked> Email verified</label>'
      : `<label>Account type <select name="account">
           <option value="personal">Personal Microsoft account</option>
           <option value="work">Work or school account</option>
           <option value="work_edov">Work or school account (verified domain, xms_edov)</option>
         </select></label>`;
  return `<!doctype html><meta charset="utf-8"><title>Mock ${p} sign-in</title>
    <h1>Mock ${p === 'google' ? 'Google' : 'Microsoft'} sign-in (tests only)</h1>
    <form method="get" action="/${p}/approve">${hidden}
      <label>Email <input name="email" required></label>
      <label>Name <input name="name"></label>
      <label>Subject <input name="sub" required></label>
      ${extra}
      <button type="submit">Continue</button>
      <button type="submit" name="cancel" value="1" formnovalidate>Cancel</button>
    </form>`;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    const [, p, ...rest] = url.pathname.split('/');
    const path = rest.join('/');
    if (!CLIENTS[p]) return send(res, 404, { error: 'unknown provider' });
    const q = url.searchParams;

    if (path === 'authorize' || path === 'oauth2/v2.0/authorize') {
      if (q.get('client_id') !== CLIENTS[p].id) return send(res, 400, 'unknown client_id', 'text/plain');
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('nonce')) return send(res, 400, 'PKCE and nonce required', 'text/plain');
      return send(res, 200, authorizePage(p, q), 'text/html');
    }
    if (path === 'approve') {
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('state', q.get('state'));
      if (q.get('cancel')) {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = randomBytes(16).toString('hex');
        const account = q.get('account') ?? 'personal';
        const tid = p === 'microsoft' ? (account === 'personal' ? CONSUMER_TENANT : WORK_TENANT) : undefined;
        const claims = {
          iss: p === 'google' ? `${BASE}/google` : `${BASE}/microsoft/${tid}/v2.0`,
          aud: CLIENTS[p].id,
          sub: q.get('sub'),
          email: q.get('email'),
          name: q.get('name') || undefined,
          nonce: q.get('nonce'),
          ...(p === 'google' ? { email_verified: q.get('email_verified') === 'on' } : { tid, ...(account === 'work_edov' ? { xms_edov: true } : {}) }),
        };
        codes.set(code, { claims, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if ((path === 'token' || path === 'oauth2/v2.0/token') && req.method === 'POST') {
      const form = await readForm(req);
      const entry = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (!entry) return send(res, 400, { error: 'invalid_grant' });
      if (form.get('client_id') !== CLIENTS[p].id || form.get('client_secret') !== CLIENTS[p].secret) return send(res, 401, { error: 'invalid_client' });
      if (form.get('redirect_uri') !== entry.redirectUri) return send(res, 400, { error: 'invalid_grant', detail: 'redirect_uri' });
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== entry.challenge) return send(res, 400, { error: 'invalid_grant', detail: 'pkce' });
      const now = Math.floor(Date.now() / 1000);
      return send(res, 200, { token_type: 'Bearer', id_token: idToken({ ...entry.claims, iat: now, exp: now + 300 }) });
    }
    if (path === 'jwks' || path === 'discovery/v2.0/keys') return send(res, 200, { keys: [jwk] });
    if (path === 'health') return send(res, 200, { ok: true });
    return send(res, 404, { error: 'not found' });
  })
  .listen(PORT, () => process.stdout.write(`mock OIDC provider on ${BASE}\n`));
