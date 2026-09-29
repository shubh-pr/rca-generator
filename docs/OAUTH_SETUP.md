# Sign in with Google and Microsoft: setup

The app supports three ways to sign in: email and password (always on), **Sign in with Google** and **Sign in with Microsoft**. Each provider is off until you set its two values. The button appears on the login and sign-up pages only when both are set.

| Variable | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → your OAuth client (step A5) |
| `GOOGLE_CLIENT_SECRET` | same place |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra ID → App registration → *Application (client) ID* (step B3) |
| `MICROSOFT_CLIENT_SECRET` | Entra ID → App registration → Certificates & secrets → the secret's **Value** (step B5) |
| `MICROSOFT_TENANT` | `common` (default): work, school **and** personal Microsoft accounts. Other options are in section C. |
| `OAUTH_REDIRECT_BASE_URL` | The public address of the app. It defaults to `APP_URL` and must have the same scheme, host and port. |

## The redirect URIs

Both providers send the user back to the API, which is served under `/api` on the app's own address:

```
<OAUTH_REDIRECT_BASE_URL>/api/v1/auth/google/callback
<OAUTH_REDIRECT_BASE_URL>/api/v1/auth/microsoft/callback
```

Register these **exactly**: scheme, host, port and path, with no trailing slash.

| Environment | `APP_URL` / `OAUTH_REDIRECT_BASE_URL` | Google redirect URI | Microsoft redirect URI |
|---|---|---|---|
| Dev servers (`npm run dev`) | `http://localhost:5173` | `http://localhost:5173/api/v1/auth/google/callback` | `http://localhost:5173/api/v1/auth/microsoft/callback` |
| Local Docker (`docker compose up`) | `http://localhost:8080` | `http://localhost:8080/api/v1/auth/google/callback` | `http://localhost:8080/api/v1/auth/microsoft/callback` |
| Production | `https://rca.example.com` (your domain) | `https://rca.example.com/api/v1/auth/google/callback` | `https://rca.example.com/api/v1/auth/microsoft/callback` |

Both providers accept `http://localhost` for testing. Every other address must use `https`, and the API refuses a non-https `OAUTH_REDIRECT_BASE_URL` in production.

**Recommendation:** use one Google OAuth client and one Microsoft app registration for local development, and a separate pair for production. Then a production secret never sits on a laptop, and you can delete the development pair at any time.

---

## A. Google (Google Cloud Console)

Console: https://console.cloud.google.com. Google now calls the consent-screen area **Google Auth Platform**; older screens call it *APIs & Services → OAuth consent screen*.

1. **Project.** Use the project picker at the top → **New project**. Give it a name (for example `rca-dashboard-prod`) → **Create**, then select it.
2. **Consent screen: basics.** Menu → **Google Auth Platform** → **Get started**.
   - **App information:** the app name users will see (for example "RCA Dashboard") and a user support email.
   - **Audience:** **External**, so any Google account can sign in, not only your own organisation.
   - **Contact information:** your email → accept the policy → **Create**.
3. **Branding.** Google Auth Platform → **Branding**:
   - Application home page: `https://rca.example.com`
   - Privacy policy: `https://rca.example.com/privacy`
   - Terms of service: `https://rca.example.com/terms`
   - Authorized domains: `rca.example.com` (the registered domain, without `https://`)

   Leave the logo empty unless you want to go through Google's brand verification; uploading a logo triggers a review.
4. **Scopes.** Google Auth Platform → **Data access** → **Add or remove scopes**. Tick `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` → **Update** → **Save**. These are non-sensitive scopes and need no verification review.
5. **OAuth client.** Google Auth Platform → **Clients** → **Create client**:
   - Application type: **Web application**
   - Name: for example `RCA Dashboard (production)`
   - **Authorized redirect URIs** → **Add URI** → `https://rca.example.com/api/v1/auth/google/callback`. For a development client, add the `localhost` URIs from the table above.
   - **Authorized JavaScript origins** are not needed; the whole flow runs on the server.
   - **Create**. Copy the **Client ID** into `GOOGLE_CLIENT_ID` and the **Client secret** into `GOOGLE_CLIENT_SECRET`. Download the JSON as well, because newer consoles show the secret only once.
6. **Publish.** Google Auth Platform → **Audience** → **Publish app** → confirm. While the app is in *Testing*, only the test users you list there (up to 100) can sign in, and everyone else gets "Access blocked". A development client can stay in Testing with your own account as a test user.

## B. Microsoft (Microsoft Entra ID)

Portal: https://entra.microsoft.com. You need an Entra tenant to register an app. A work or school account usually has one. With only a personal Microsoft account, create a free Azure account first (https://azure.microsoft.com/free), which gives you a tenant, then sign in to the Entra admin center with it.

1. **Register the app.** **Identity → Applications → App registrations → New registration**:
   - Name: for example `RCA Dashboard (production)`. Users see it on Microsoft's consent screen.
   - **Supported account types:** choose **"Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**. This matches `MICROSOFT_TENANT=common`, and without it personal accounts cannot sign in.
   - **Redirect URI:** platform **Web**, value `https://rca.example.com/api/v1/auth/microsoft/callback`
   - **Register.**
2. **More redirect URIs (development).** In the app → **Authentication** → under **Web** → **Add URI**, add the `localhost` URIs from the table above → **Save**. Leave *Implicit grant and hybrid flows* (Access tokens, ID tokens) **unticked**; the app uses the authorization-code flow with PKCE.
3. **Client ID.** In the app's **Overview**, copy **Application (client) ID** into `MICROSOFT_CLIENT_ID`. The *Directory (tenant) ID* is not needed with `common`.
4. **API permissions.** In the app → **API permissions**. You need the Microsoft Graph **delegated** permissions `openid`, `email` and `profile`. If they are missing: **Add a permission → Microsoft Graph → Delegated permissions** → tick them → **Add permissions**. The default `User.Read` may stay. None of these needs admin consent.
5. **Client secret.** In the app → **Certificates & secrets → Client secrets → New client secret**. Enter a description and an expiry (at most 24 months) → **Add**. Copy the **Value** column right away into `MICROSOFT_CLIENT_SECRET`. The *Secret ID* is not the secret, and the value is shown only once. **Put a calendar reminder before the expiry date:** when the secret expires, Microsoft sign-in stops working until you create a new one and update the variable.
6. **Verified-domain claim (work and school accounts).** In the app → **Token configuration → Add optional claim → Token type: ID** → tick **`xms_edov`** and **`email`** → **Add**. If asked, also tick *Turn on the Microsoft Graph email permission*.

   **Why this matters:** in a work or school tenant, an administrator can set a user's email attribute to any address, so the app does not trust that email unless Entra marks the domain as verified with `xms_edov`. Without this claim:
   - personal Microsoft accounts (outlook.com, hotmail.com, live.com) still work fully;
   - work and school accounts can still **connect** Microsoft from Account settings;
   - but they cannot create an account or be linked **by email**. They see "Microsoft did not confirm that this email address is verified".
7. **Optional: publisher verification.** In the app → **Branding & properties**. Without a verified publisher, the consent screen shows the app as *unverified*, and some organisations block users from consenting to unverified multi-tenant apps. Verification needs a Microsoft AI Cloud Partner Program ID: https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview

## C. `MICROSOFT_TENANT` values

| Value | Who can sign in | Supported account types in step B1 |
|---|---|---|
| `common` (default) | Work, school and personal accounts | Multitenant + personal accounts |
| `organizations` | Work and school accounts only | Multitenant |
| `consumers` | Personal accounts only | Personal Microsoft accounts only |
| A tenant ID (GUID) | Only accounts of that one organisation | Single tenant |

For a single tenant, use the *Directory (tenant) ID* GUID from the app's Overview, not a domain name. The app checks that every token's tenant matches it.

## D. Set the variables

| Environment | Where |
|---|---|
| Dev servers | `apps/api/.env` (copied from `apps/api/.env.example`), then restart `npm run dev` |
| Local Docker | a `.env` file in the repository root. `docker compose` reads it and passes the five `GOOGLE_*`/`MICROSOFT_*` values to the API. Then run `docker compose up -d --build`. `APP_URL` is already `http://localhost:8080` there |
| Production | `.env.prod` (from `.env.prod.example`), then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` |

Example production block:

```bash
APP_URL=https://rca.example.com
OAUTH_REDIRECT_BASE_URL=https://rca.example.com
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
MICROSOFT_CLIENT_ID=00000000-1111-2222-3333-444444444444
MICROSOFT_CLIENT_SECRET=...the secret's Value...
MICROSOFT_TENANT=common
```

The API refuses to start if only one value of a pair is set, if `OAUTH_REDIRECT_BASE_URL` has a different origin from `APP_URL`, or if it is not https in production. `.env` and `.env.prod` are git-ignored; never commit them.

## E. Check it

1. Open `/login` and `/signup`. **Sign in with Google** and **Sign in with Microsoft** appear above the email form.
2. Sign up with a new Google account. You land on the welcome screen. In **Account settings → Connected accounts**, Google shows as connected, and **Disconnect Google** is disabled with "This is your only way to sign in".
3. Set a password there. **Disconnect** becomes available.
4. With an existing email and password account, click **Sign in with Microsoft** using a personal Microsoft account with the same email. You are signed in to the existing account, and Connected accounts lists Microsoft.
5. In Account settings, click **Connect Google** or **Connect Microsoft** and pick an account with a *different* email. It is connected, and signing in with it opens this account.

## F. Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| Google: *Error 400: redirect_uri_mismatch* | The redirect URI is not registered exactly | Add the exact URI from the table to the client (step A5) |
| Google: *Access blocked: … has not completed the Google verification process* | The app is still in Testing | Publish it (A6), or add the account as a test user |
| Microsoft: *AADSTS50011* | Redirect URI mismatch | Add the exact URI under Authentication → Web (B2) |
| Microsoft: *AADSTS700016* or *AADSTS50194* | Supported account types do not match `MICROSOFT_TENANT` | Match the table in section C |
| Microsoft: *AADSTS7000215: Invalid client secret* | The *Secret ID* was copied, or the secret expired | Create a new secret and copy its **Value** (B5) |
| App: "… did not confirm that this email address is verified" | Google says the email is unverified, or a work account lacks `xms_edov` | Verify the email with the provider, or add the optional claim (B6) |
| App: "This email already has a different Google/Microsoft account connected" | The account already has another identity from that provider | Sign in with that one, or disconnect it in Account settings first |
| The buttons do not appear | One of the two values is missing, or the API was not restarted | Set both values and restart the API |

## How the app uses these accounts

The rules are recorded in `docs/ASSUMPTIONS.md` under "Sign in with Google and Microsoft":
- **Returning users** are recognised by the provider's account ID (`sub`), stored in `user_identities`, not by email.
- **New identity, verified email:** it creates an account, or is linked to an existing account with that email.
- **New identity, unverified email:** refused, to prevent account takeover.
- **Several methods per account:** one account can have a password, Google and Microsoft at the same time.
- **Last method:** the last remaining sign-in method cannot be removed.
- **In tests:** a local fake provider (`apps/web/e2e/mockOidc.mjs`, enabled by `OAUTH_TEST_PROVIDER_URL`) stands in for both providers, so tests never call Google or Microsoft. Production refuses `OAUTH_TEST_PROVIDER_URL`.
