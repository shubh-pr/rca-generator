import fs from 'node:fs';
import path from 'node:path';

/** Point the API at the test database. Refuses anything not named *_test. */
export function applyTestEnv() {
  const envFile = path.resolve(import.meta.dirname, '../.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://rca:rca@localhost:5433/rca_test';
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must point to a *_test database, got ${url}`);
  }
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.MAIL_LOG_FILE = '';
  process.env.APP_URL = 'http://app.test';
  // Rate limits are exercised in their own test (which switches them on).
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.TURNSTILE_ENABLED = 'false';
  process.env.SEED_DEMO = 'false';
  process.env.UPLOAD_DIR = path.resolve(import.meta.dirname, '../test-uploads');
  return url;
}
