# Deploying RCA Dashboard

This guide takes you from an empty server to a running site with HTTPS, email, object storage and nightly backups. It uses `docker-compose.prod.yml`: **Caddy** serves the web app and gets certificates automatically, **api** runs the Node API and PDF rendering, **db** runs PostgreSQL 16, and **backup** takes nightly `pg_dump` backups.

Time needed: about an hour, most of it waiting for DNS and email verification.

---

## 0. What you need

| Item | Notes |
|---|---|
| A Linux server (VM) | 2 vCPU, 4 GB RAM and 40 GB disk are enough to start. Ubuntu 24.04 or Debian 12. Ports 80 and 443 open. |
| Docker Engine 24+ with the compose plugin | `curl -fsSL https://get.docker.com \| sh` |
| A domain | For example `rca.example.com`. You must be able to edit its DNS records. |
| An email provider | Resend (simplest) or any SMTP service (Postmark, Amazon SES, Mailgun, Brevo…). |
| An S3-compatible bucket | Cloudflare R2, AWS S3, Backblaze B2 or MinIO. Attachments live here. |
| Optional: an off-site bucket for backups | Can be the same provider, but use a separate bucket. |
| Optional: Cloudflare Turnstile keys | CAPTCHA on sign-up and forgot-password. |

## 1. Domain and DNS

1. Create an **A** record `rca.example.com → <server IPv4>`, plus an **AAAA** record if the server has IPv6.
2. Wait until `dig +short rca.example.com` returns the server's address.
3. Do **not** put a CDN proxy in front yet (Cloudflare "orange cloud" off). Caddy must answer Let's Encrypt's HTTP challenge directly. You can enable the proxy later with SSL mode "Full (strict)".

## 2. HTTPS

Nothing to do by hand. Once `SITE_ADDRESS=rca.example.com` is set (step 5), Caddy obtains and renews a Let's Encrypt certificate on first start and redirects HTTP to HTTPS. It sends HSTS, CSP and the other security headers (see `apps/web/Caddyfile`). Certificates are kept in the `caddy_data` volume. `ACME_EMAIL` receives expiry warnings, if ever needed.

## 3. Email provider, with SPF, DKIM and DMARC

The app sends verification, password-reset, invitation and account-deletion emails. Without a correctly set-up sender domain these land in spam.

**Resend (recommended):**
1. In Resend, go to **Domains → Add domain** and enter `rca.example.com` (or a subdomain such as `mail.example.com`).
2. Add the DNS records Resend shows: an SPF `TXT`/`MX` on the send subdomain and DKIM `TXT` records.
3. Add a DMARC record at `_dmarc.example.com`: `TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"`.
4. Wait until Resend shows the domain as *Verified*, then create an API key with **sending access only**.
5. In `.env.prod`: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_…`, `EMAIL_FROM=RCA Dashboard <no-reply@rca.example.com>`.

**Any SMTP provider:**
1. Verify the sender domain in the provider's dashboard and add the SPF and DKIM records it gives you, plus the DMARC record from above.
2. In `.env.prod`: `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS: `SMTP_SECURE=false`; 465: `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` on the verified domain.

The `console` provider (which prints emails to the log) is refused in production.

## 4. Object storage bucket (attachments)

Create a **private** bucket (no public access) and an access key limited to that bucket. The app streams downloads through the API after checking permissions, so the bucket never needs to be public.

| Provider | Settings |
|---|---|
| **Cloudflare R2** | R2 → Create bucket `rca-attachments`. Then Manage R2 API tokens → *Object Read & Write*, restricted to that bucket. `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`. |
| **AWS S3** | Create the bucket with *Block all public access* on. Create an IAM user with a policy allowing `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::rca-attachments/*` and `s3:ListBucket` on the bucket. Leave `S3_ENDPOINT` empty and set `S3_REGION` (e.g. `ap-south-1`). |
| **Backblaze B2** | Create a private bucket and an application key for it. `S3_ENDPOINT=https://s3.<region>.backblazeb2.com`, `S3_REGION=<region>`. |
| **MinIO (self-hosted)** | `S3_ENDPOINT=https://minio.example.com`, `S3_FORCE_PATH_STYLE=true`. |

Then set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Turn on **bucket versioning** (or the provider's object-lock or lifecycle equivalent) so deleted or overwritten files can be recovered; this is the backup for attachments. Local disk storage is refused in production.

## 5. Environment variables

```bash
git clone <your repository> rca && cd rca
cp .env.prod.example .env.prod
chmod 600 .env.prod
openssl rand -base64 48   # use once for JWT_SECRET
openssl rand -base64 32   # use once for POSTGRES_PASSWORD
```

Fill in **every** value in `.env.prod`. The file is commented, and the API validates it at start-up: a missing or unsafe setting stops the container with a clear message (`docker compose … logs api`).

| Variable | Meaning |
|---|---|
| `SITE_ADDRESS`, `APP_URL` | Your domain, and `https://` + the domain. Links in emails use `APP_URL`. |
| `ACME_EMAIL` | Contact address for Let's Encrypt. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials. The database is only reachable inside the compose network. |
| `DATABASE_POOL_SIZE` | Connections per API process (default 10). |
| `JWT_SECRET` | At least 32 random characters. Changing it signs everyone out. |
| `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS` | Session lengths (15 minutes and 30 days). |
| `COOKIE_SECURE` | Keep `true` behind HTTPS. |
| `EMAIL_*`, `SMTP_*`, `RESEND_API_KEY` | See step 3. |
| `STORAGE_DRIVER`, `S3_*` | See step 4. |
| `MAX_UPLOAD_MB`, `QUOTA_STORAGE_MB`, `QUOTA_RCA_COUNT` | Per file 10 MB, per user 200 MB and 500 RCAs. Per-user overrides go in the `usage_quotas` table. |
| `LOGIN_MAX_PER_IP`, `LOGIN_MAX_PER_ACCOUNT`, `SIGNUP_MAX_PER_IP`, `EMAIL_MAX_PER_IP`, `EMAIL_MAX_PER_ACCOUNT`, `LOCKOUT_*` | Rate limits and account lockout. |
| `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional CAPTCHA (Cloudflare dashboard → Turnstile → add site with your domain). |
| `PDF_TIMEOUT_MS`, `PDF_CONCURRENCY`, `PDF_CHROMIUM_SANDBOX` | PDF renderer limits. Keep the sandbox on. |
| `ACCOUNT_DELETION_GRACE_DAYS`, `JOBS_ENABLED`, `JOBS_INTERVAL_MINUTES` | Account deletion grace period and the background job. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in (see `docs/ASSUMPTIONS.md`). |
| `PAYMENT_PROVIDER`, `STRIPE_*`, `*_PRICE_CENTS`, `BILLING_CURRENCY` | Payments. Production needs `stripe` with all six `STRIPE_*` values; follow `docs/STRIPE_SETUP.md`. The mock provider is refused unless `ALLOW_MOCK_PAYMENTS=true` (staging only). |
| `QUOTA_OWNED_WORKSPACES` | Workspaces one user may own (default 5). |
| `BACKUP_*` | See step 7. |
| `LOG_LEVEL` | `info` by default. Logs are JSON on stdout, without personal data or tokens. |

### Optional: Google sign-in

1. In Google Cloud Console, go to **APIs & Services → OAuth consent screen**. Choose *External*, and enter the app name, support email, your domain and links to your `/privacy` and `/terms` pages. The only scopes needed are `openid`, `email` and `profile`, which need no verification review.
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origin: `https://rca.example.com`
   - Authorized redirect URI: `https://rca.example.com/api/v1/auth/google/callback`
3. Put the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the api. The "Continue with Google" button appears on the login and sign-up pages.
4. **Publish** the consent screen (move it out of *Testing*), otherwise only listed test users can sign in.

## 6. First deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api caddy
```

- Database migrations run automatically every time the api container starts (`prisma migrate deploy`). No seed or demo data runs in production.
- Wait until `api` is *healthy* (its health check calls `/readyz`, which checks the database and storage) and Caddy has logged `certificate obtained successfully`.
- Open `https://rca.example.com`, sign up, and check that the verification email arrives. If it doesn't, look for "email send failed" in the api logs.

**Updating:** `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`. Take a backup first (step 7); migrations run on start. The API shuts down gracefully on SIGTERM.

### Chromium sandbox

The api container runs as the unprivileged `pwuser`, with a read-only root filesystem, `no-new-privileges`, and the Playwright seccomp profile (`ops/seccomp/chromium.json`). That profile lets Chromium use its own sandbox for PDF rendering.

**Ubuntu 24.04 hosts:** AppArmor blocks the unprivileged user namespaces the sandbox needs, so PDF export fails with "Chromium sandboxing failed". The same thing happened on GitHub's CI runners. Allow them once on the host and keep the setting across reboots:

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-chromium-sandbox.conf
sudo sysctl --system
```

Debian 12 does not need this. Only if you cannot change host settings (for example on a PaaS), set `PDF_CHROMIUM_SANDBOX=false`. The renderer still only ever loads one internal, single-use print page and blocks every other request.

## 7. Backups and restore

**Database:** the `backup` service runs `pg_dump` (custom format, verified with `pg_restore --list`) on `BACKUP_SCHEDULE` (default 02:30 UTC daily). It keeps `BACKUP_RETENTION_DAYS` (default 14) of dumps in the `backups` volume. It also copies each dump off-site when `BACKUP_S3_BUCKET` and its keys are set. **Set the off-site copy**: a backup on the same server does not survive losing the server.

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C exec backup backup.sh                    # take a backup now
$C exec backup ls -lh /backups              # list backups
```

**Restore** (replaces the current database):

```bash
$C stop api
$C exec backup restore.sh /backups/rca-20261001T023000Z.dump
$C start api
```

To restore from the off-site copy, first download it into the volume, for example with `$C exec backup aws s3 cp s3://<bucket>/postgres/<file>.dump /backups/` (add `--endpoint-url` for non-AWS providers).

**Attachments:** they live in the object-storage bucket. Enable versioning there (step 4), and for disaster recovery add the provider's replication or a scheduled `rclone sync` to a second bucket.

**Test the restore** at least once after going live and after major upgrades. Restore into a staging copy of the stack and log in.

**Rolling back the B2C migration** on a database upgraded from the internal tool: restore the `pg_dump` you took before the upgrade. `apps/api/prisma/migrations/20260928120000_b2c_tenancy/down.sql` is a best-effort reverse script; see the comment at its top.

## 8. Make yourself the platform admin

Sign up and verify your own account on the site, then:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node dist/scripts/promote-admin.js you@example.com
```

Log out and in again; **Operator console** appears in the menu.

The operator console shows account and workspace metadata only. Reading a workspace's RCAs requires **Support access…**: you give a reason and a duration (at most 4 hours). Access is read-only, and the event appears in that workspace's audit log for its owners to see. To remove the flag: `… exec api node dist/scripts/promote-admin.js you@example.com --revoke`.

## 9. Before you announce the site

Work through this checklist:

- [ ] Replace every `[REPLACE BEFORE LAUNCH: …]` in `apps/web/src/pages/public/LegalPages.tsx` (Terms, Privacy, Contact) and rebuild. Have a lawyer review the Terms and Privacy Policy for your jurisdiction (GDPR and the India DPDP Act 2023).
- [ ] Replace the screenshot placeholders on the landing page (`apps/web/src/pages/public/LandingPage.tsx`).
- [ ] Set real secrets: `JWT_SECRET`, `POSTGRES_PASSWORD`, and the email, storage and backup keys. `.env.prod` must be `chmod 600` and never committed.
- [ ] Email domain verified, with SPF, DKIM and DMARC in place. Send yourself a verification and a password-reset email.
- [ ] Storage bucket private, versioning on, access key limited to the bucket.
- [ ] Off-site backups configured, and one restore tested.
- [ ] Payments: `PAYMENT_PROVIDER=stripe` with live keys, the webhook registered and one real test purchase refunded (`docs/STRIPE_SETUP.md`).
- [ ] Optional: Turnstile keys, if you get sign-up spam.
- [ ] Server: automatic security updates (`unattended-upgrades`), SSH key login only, firewall allowing only 22, 80 and 443.
- [ ] On Ubuntu 24.04: apply the Chromium sandbox sysctl (step 6), then export one PDF to check.
- [ ] Monitoring: an uptime check on `https://rca.example.com/api/v1/health`, and alerts on container restarts.
- [ ] If you upgraded from the internal tool: run `docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node dist/scripts/purge-demo-data.js` (dry run), then add `--confirm` to remove the `@rca.local` demo accounts, if they exist.

---

## Other hosts

The app is three processes: the **api** container (`apps/api/Dockerfile`), the **web** static files (`apps/web/Dockerfile`, a Caddy image, or just the `dist/` folder), and **PostgreSQL**. On a platform service:

### Render

1. Create a **PostgreSQL** instance and copy its *Internal Database URL*.
2. Create a **Web Service** from the repository with Docker, Dockerfile path `apps/api/Dockerfile`, port 4000, health check path `/readyz`. Add the variables from `.env.prod.example`, with `DATABASE_URL` set to the internal URL, `TRUST_PROXY=1` and `PDF_CHROMIUM_SANDBOX=false`. Platform containers usually do not allow the Chromium sandbox; the renderer's own restrictions still apply.
3. Create a **Static Site**: build command `npm ci --ignore-scripts && npm run build -w @rca/web`, publish directory `apps/web/dist`. Add a rewrite `/api/*` → `https://<api-service>.onrender.com/api/:splat` and a rewrite `/*` → `/index.html`. Use one custom domain on the static site so that cookies stay first-party.
4. Set `APP_URL` and `CORS_ORIGIN` to the static site's domain.

### Railway

1. Add a **PostgreSQL** plugin.
2. Add a service from the repository with `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`. Set the variables, including `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `TRUST_PROXY=1` and `PDF_CHROMIUM_SANDBOX=false`. Health check path `/readyz`.
3. Add a second service from the same repository with `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile` and `SITE_ADDRESS=:${{PORT}}`. In `apps/web/Caddyfile`, change `reverse_proxy api:4000` to the api service's private domain (e.g. `api.railway.internal:4000`). Attach your domain to this service.

### Fly.io

1. `fly postgres create`, then `fly postgres attach` to the api app (this sets `DATABASE_URL`).
2. api: `fly launch --dockerfile apps/api/Dockerfile --no-deploy`. Set `internal_port = 4000` and a `[checks]` HTTP check on `/readyz`. Add the variables with `fly secrets set KEY=value …`, including `PDF_CHROMIUM_SANDBOX=false`, then `fly deploy`.
3. web: a second app from `apps/web/Dockerfile` with `SITE_ADDRESS=:8080` and the Caddyfile's `reverse_proxy` pointing at `<api-app>.internal:4000`. Then `fly certs add rca.example.com`.

On every host: run exactly one api instance (rate limits and one-time print tokens are kept in memory), keep PostgreSQL backups on (the platforms offer point-in-time recovery), and use S3-compatible storage for attachments.
