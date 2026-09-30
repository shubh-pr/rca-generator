import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Up/down test of 20261001090000_user_identities on its own database (the main test database is untouched). */
const MIGRATIONS = path.resolve(import.meta.dirname, '../prisma/migrations');
const TARGET = '20261001090000_user_identities';
const before = fs.readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d) && d < TARGET).sort();
const sql = (dir: string, file = 'migration.sql') => fs.readFileSync(path.join(MIGRATIONS, dir, file), 'utf8');

const base = new URL(process.env.DATABASE_URL!);
const DB = 'rca_identity_migration_test';
const url = (name: string) => Object.assign(new URL(base), { pathname: `/${name}` }).toString();
let db: pg.Client;
const q = async <T = Record<string, unknown>>(text: string) => (await db.query(text)).rows as T[];

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: url('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  db = new pg.Client({ connectionString: url(DB) });
  await db.connect();
  for (const dir of before) await db.query(sql(dir));
  await db.query(`
    INSERT INTO users (id, name, email, google_sub, created_at, updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Gia Google', 'gia@x.test', 'google-sub-1', '2026-09-20T10:00:00Z', now()),
      ('00000000-0000-4000-8000-000000000002', 'Pat Password', 'pat@x.test', NULL, now(), now());
  `);
});

afterAll(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: url('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
});

describe('user_identities migration', () => {
  it('up: existing Google links become identities and users.google_sub is removed', async () => {
    await db.query(sql(TARGET));
    const rows = await q<{ user_id: string; provider: string; provider_account_id: string; email: string; linked_at: Date }>('SELECT * FROM user_identities');
    expect(rows).toEqual([
      expect.objectContaining({ user_id: '00000000-0000-4000-8000-000000000001', provider: 'GOOGLE', provider_account_id: 'google-sub-1', email: 'gia@x.test', linked_at: new Date('2026-09-20T10:00:00Z') }),
    ]);
    const cols = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_sub'`);
    expect(cols).toHaveLength(0);
  });

  it('down: Google identities go back to users.google_sub; the table and type are dropped', async () => {
    await db.query(sql(TARGET, 'down.sql'));
    expect(await q(`SELECT id, google_sub FROM users ORDER BY id`)).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', google_sub: 'google-sub-1' },
      { id: '00000000-0000-4000-8000-000000000002', google_sub: null },
    ]);
    expect(await q(`SELECT to_regclass('user_identities') AS t`)).toEqual([{ t: null }]);
  });

  it('down refuses to run while Microsoft identities exist (they would be lost silently)', async () => {
    await db.query(sql(TARGET));
    await db.query(`INSERT INTO user_identities (id, user_id, provider, provider_account_id) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'MICROSOFT', 'ms-sub')`);
    await expect(db.query(sql(TARGET, 'down.sql'))).rejects.toThrow(/MICROSOFT rows/);
    expect(await q(`SELECT count(*)::int AS n FROM user_identities`)).toEqual([{ n: 2 }]);
  });
});
