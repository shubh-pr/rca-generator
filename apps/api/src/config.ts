/**
 * All settings come from environment variables, validated once at startup (fail fast).
 * Every variable is documented in apps/api/.env.example.
 */
import path from 'node:path';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)));
const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production-000';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, 1),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_SIZE: int(10, 1),
    /** Public URL of the web app; used for links in emails and as the default CORS origin. */
    APP_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGIN: optional,
    /** Express "trust proxy": false, true, a hop count, or a comma list of subnets (e.g. loopback). */
    TRUST_PROXY: z.string().default('false'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

    JWT_SECRET: z.string().default(DEV_SECRET),
    ACCESS_TOKEN_TTL_MINUTES: int(15, 1),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1),
    COOKIE_SECURE: optional,
    COOKIE_DOMAIN: optional,

    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().default('RCA Dashboard <no-reply@localhost>'),
    MAIL_LOG_FILE: optional,
    SMTP_HOST: optional,
    SMTP_PORT: int(587, 1),
    SMTP_SECURE: bool(false),
    SMTP_USER: optional,
    SMTP_PASS: optional,
    RESEND_API_KEY: optional,

    TURNSTILE_ENABLED: bool(false),
    TURNSTILE_SITE_KEY: optional,
    TURNSTILE_SECRET_KEY: optional,

    RATE_LIMIT_ENABLED: bool(true),
    LOGIN_MAX_PER_IP: int(30, 1),
    LOGIN_MAX_PER_ACCOUNT: int(10, 1),
    SIGNUP_MAX_PER_IP: int(10, 1),
    EMAIL_MAX_PER_IP: int(10, 1),
    EMAIL_MAX_PER_ACCOUNT: int(3, 1),
    LOCKOUT_THRESHOLD: int(10, 1),
    LOCKOUT_MINUTES: int(15, 1),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads'),
    S3_BUCKET: optional,
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: optional,
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_FORCE_PATH_STYLE: bool(false),
    SIGNED_URL_TTL_SECONDS: int(60, 10),
    MAX_UPLOAD_MB: int(10, 1),
    QUOTA_STORAGE_MB: int(200, 1),
    QUOTA_RCA_COUNT: int(500, 1),
    /** Workspaces one user may own, the personal one included (each unsubscribed workspace has its own free RCA bucket). */
    QUOTA_OWNED_WORKSPACES: int(5, 1),

    PDF_TIMEOUT_MS: int(20_000, 1000),
    PDF_CONCURRENCY: int(2, 1),
    PDF_CHROMIUM_SANDBOX: bool(true),
    /** Base URL Chromium uses to load the internal print page (the API itself). */
    INTERNAL_BASE_URL: optional,

    ACCOUNT_DELETION_GRACE_DAYS: int(14, 0),
    JOBS_ENABLED: bool(true),
    JOBS_INTERVAL_MINUTES: int(60, 1),

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,

    SEED_DEMO: bool(false),

    // ---------- Billing (docs/BILLING_PLAN.md) ----------
    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    /** The mock provider grants paid features without payment; refused in production unless this is true (staging). */
    ALLOW_MOCK_PAYMENTS: bool(false),
    MOCK_WEBHOOK_SECRET: z.string().default('mock-webhook-secret-for-tests'),
    BILLING_CURRENCY: z
      .string()
      .regex(/^[A-Za-z]{3}$/, 'must be an ISO 4217 code such as USD')
      .default('USD')
      .transform((v) => v.toUpperCase()),
    FREE_RCA_LIMIT: int(3, 0),
    RCA_UNLOCK_PRICE_CENTS: int(900, 0),
    SOLO_MONTHLY_PRICE_CENTS: int(1200, 0),
    TEAM_BASE_PRICE_CENTS: int(2900, 0),
    TEAM_SEAT_PRICE_CENTS: int(800, 0),
    TEAM_MIN_SEATS: int(1, 1),
    TEAM_MAX_SEATS: int(100, 1),
    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,
    STRIPE_PRICE_RCA_UNLOCK: optional,
    STRIPE_PRICE_SOLO_MONTHLY: optional,
    STRIPE_PRICE_TEAM_BASE: optional,
    STRIPE_PRICE_TEAM_SEAT: optional,
  })
  .superRefine((e, ctx) => {
    const prod = e.NODE_ENV === 'production';
    const need = (cond: boolean, key: string, message: string) => {
      if (cond) ctx.addIssue({ code: 'custom', path: [key], message });
    };
    need(prod && (e.JWT_SECRET === DEV_SECRET || e.JWT_SECRET.length < 32), 'JWT_SECRET', 'must be set to a random string of at least 32 characters in production');
    need(prod && e.EMAIL_PROVIDER === 'console', 'EMAIL_PROVIDER', 'console is for development only; use smtp or resend in production');
    need(e.EMAIL_PROVIDER === 'smtp' && !e.SMTP_HOST, 'SMTP_HOST', 'is required when EMAIL_PROVIDER=smtp');
    need(e.EMAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY, 'RESEND_API_KEY', 'is required when EMAIL_PROVIDER=resend');
    need(e.TURNSTILE_ENABLED && (!e.TURNSTILE_SITE_KEY || !e.TURNSTILE_SECRET_KEY), 'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required when TURNSTILE_ENABLED=true');
    need(e.STORAGE_DRIVER === 's3' && (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY), 'S3_BUCKET', 'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3');
    need(prod && e.STORAGE_DRIVER === 'local', 'STORAGE_DRIVER', 'local disk storage is for development only; use s3 in production');
    need(!!e.GOOGLE_CLIENT_ID !== !!e.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
    need(
      prod && e.PAYMENT_PROVIDER === 'mock' && !e.ALLOW_MOCK_PAYMENTS,
      'PAYMENT_PROVIDER',
      'mock would unlock paid features without payment; use stripe in production (or ALLOW_MOCK_PAYMENTS=true on a staging server)',
    );
    need(prod && e.PAYMENT_PROVIDER === 'mock' && e.MOCK_WEBHOOK_SECRET === 'mock-webhook-secret-for-tests', 'MOCK_WEBHOOK_SECRET', 'set a random secret when the mock provider runs on a server');
    for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_RCA_UNLOCK', 'STRIPE_PRICE_SOLO_MONTHLY', 'STRIPE_PRICE_TEAM_BASE', 'STRIPE_PRICE_TEAM_SEAT'] as const) {
      need(e.PAYMENT_PROVIDER === 'stripe' && !e[key], key, 'is required when PAYMENT_PROVIDER=stripe (docs/STRIPE_SETUP.md)');
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseTrustProxy(v: string): boolean | number | string {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databasePoolSize: e.DATABASE_POOL_SIZE,
    appUrl: e.APP_URL.replace(/\/$/, ''),
    corsOrigin: (e.CORS_ORIGIN ?? e.APP_URL).replace(/\/$/, ''),
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    logLevel: e.LOG_LEVEL,
    jwtSecret: e.JWT_SECRET,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_MINUTES * 60,
    refreshTokenTtlMs: e.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    cookieSecure: e.COOKIE_SECURE === undefined ? e.NODE_ENV === 'production' : e.COOKIE_SECURE === 'true',
    cookieDomain: e.COOKIE_DOMAIN,
    email: {
      provider: e.EMAIL_PROVIDER,
      from: e.EMAIL_FROM,
      logFile: e.MAIL_LOG_FILE,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS },
      resendApiKey: e.RESEND_API_KEY,
    },
    turnstile: { enabled: e.TURNSTILE_ENABLED, siteKey: e.TURNSTILE_SITE_KEY, secretKey: e.TURNSTILE_SECRET_KEY },
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED,
      loginPerIp: e.LOGIN_MAX_PER_IP,
      loginPerAccount: e.LOGIN_MAX_PER_ACCOUNT,
      signupPerIp: e.SIGNUP_MAX_PER_IP,
      emailPerIp: e.EMAIL_MAX_PER_IP,
      emailPerAccount: e.EMAIL_MAX_PER_ACCOUNT,
      lockoutThreshold: e.LOCKOUT_THRESHOLD,
      lockoutMs: e.LOCKOUT_MINUTES * 60_000,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      s3: {
        bucket: e.S3_BUCKET,
        region: e.S3_REGION,
        endpoint: e.S3_ENDPOINT,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
      signedUrlTtlSeconds: e.SIGNED_URL_TTL_SECONDS,
    },
    uploadDir: path.resolve(e.UPLOAD_DIR),
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    quota: { storageBytes: e.QUOTA_STORAGE_MB * 1024 * 1024, rcaCount: e.QUOTA_RCA_COUNT, ownedWorkspaces: e.QUOTA_OWNED_WORKSPACES },
    pdf: { timeoutMs: e.PDF_TIMEOUT_MS, concurrency: e.PDF_CONCURRENCY, chromiumSandbox: e.PDF_CHROMIUM_SANDBOX, internalBaseUrlOverride: e.INTERNAL_BASE_URL },
    accountDeletionGraceMs: e.ACCOUNT_DELETION_GRACE_DAYS * 86_400_000,
    jobs: { enabled: e.JOBS_ENABLED, intervalMs: e.JOBS_INTERVAL_MINUTES * 60_000 },
    google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET },
    seedDemo: e.SEED_DEMO,
    billing: {
      provider: e.PAYMENT_PROVIDER,
      mockWebhookSecret: e.MOCK_WEBHOOK_SECRET,
      currency: e.BILLING_CURRENCY,
      freeRcaLimit: e.FREE_RCA_LIMIT,
      prices: {
        rcaUnlock: e.RCA_UNLOCK_PRICE_CENTS,
        soloMonthly: e.SOLO_MONTHLY_PRICE_CENTS,
        teamBase: e.TEAM_BASE_PRICE_CENTS,
        teamSeat: e.TEAM_SEAT_PRICE_CENTS,
      },
      teamSeats: { min: e.TEAM_MIN_SEATS, max: e.TEAM_MAX_SEATS },
      stripe: {
        secretKey: e.STRIPE_SECRET_KEY,
        webhookSecret: e.STRIPE_WEBHOOK_SECRET,
        priceRcaUnlock: e.STRIPE_PRICE_RCA_UNLOCK,
        priceSoloMonthly: e.STRIPE_PRICE_SOLO_MONTHLY,
        priceTeamBase: e.STRIPE_PRICE_TEAM_BASE,
        priceTeamSeat: e.STRIPE_PRICE_TEAM_SEAT,
      },
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;

export const config: Config = loadConfig();
