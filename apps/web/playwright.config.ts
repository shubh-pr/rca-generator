import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const MOCK_OIDC_PORT = 4200;
/** Stand-in for Google and Microsoft (e2e/mockOidc.mjs); the API is pointed at it, real providers are never called. */
const OAUTH = {
  GOOGLE_CLIENT_ID: 'e2e-google-client',
  GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
  MICROSOFT_CLIENT_ID: 'e2e-microsoft-client',
  MICROSOFT_CLIENT_SECRET: 'e2e-microsoft-secret',
};
const WEB_PORT = 5174;
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://rca:rca@localhost:5433/rca_e2e';
/** The console email provider appends every email here; tests read verification links from it. */
export const MAIL_LOG = path.resolve(import.meta.dirname, 'e2e/.mail.log');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node e2e/mockOidc.mjs',
      url: `http://localhost:${MOCK_OIDC_PORT}/google/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_OIDC_PORT: String(MOCK_OIDC_PORT), ...OAUTH },
    },
    {
      // Fresh, seeded rca_e2e database, then the API.
      command: 'npm run e2e:serve -w @rca/api',
      cwd: '../..',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        DATABASE_URL: DB,
        PORT: String(API_PORT),
        JWT_SECRET: 'e2e-secret',
        // No demo data: the journeys start from an empty database, like production.
        NODE_ENV: 'development',
        SEED_DEMO: 'false',
        EMAIL_PROVIDER: 'console',
        MAIL_LOG_FILE: MAIL_LOG,
        APP_URL: `http://localhost:${WEB_PORT}`,
        LOGIN_MAX_PER_IP: '1000',
        SIGNUP_MAX_PER_IP: '1000',
        EMAIL_MAX_PER_IP: '1000',
        UPLOAD_DIR: './test-uploads/e2e',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        ...OAUTH,
        OAUTH_TEST_PROVIDER_URL: `http://localhost:${MOCK_OIDC_PORT}`,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
