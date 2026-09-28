import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 5174;
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://rca:rca@localhost:5433/rca_e2e';

export default defineConfig({
  testDir: './e2e',
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
        UPLOAD_DIR: './test-uploads/e2e',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
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
