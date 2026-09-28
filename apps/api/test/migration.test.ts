import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Up/down test of the B2C migration on a database built at the pre-B2C schema with legacy data.
 * Uses its own database (rca_migration_test) so the main test database is untouched.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, '../prisma/migrations');
const INIT = fs.readFileSync(path.join(MIGRATIONS, '20260928100337_init/migration.sql'), 'utf8');
const UP = fs.readFileSync(path.join(MIGRATIONS, '20260928120000_b2c_tenancy/migration.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(MIGRATIONS, '20260928120000_b2c_tenancy/down.sql'), 'utf8');

const base = new URL(process.env.DATABASE_URL!);
const DB = 'rca_migration_test';
let db: pg.Client;

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  db = new pg.Client({ connectionString: Object.assign(new URL(base), { pathname: `/${DB}` }).toString() });
  await db.connect();
  await db.query(INIT);

  // Legacy data: 5 users across roles, one company/project, two RCAs, audit rows.
  await db.query(`
    INSERT INTO users (id, name, email, password_hash, role, team, updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Ada Admin', 'admin@x.test', 'h', 'ADMIN', NULL, now()),
      ('00000000-0000-4000-8000-000000000002', 'Olga Owner', 'owner@x.test', 'h', 'PROJECT_OWNER', NULL, now()),
      ('00000000-0000-4000-8000-000000000003', 'Leo Lead', 'lead@x.test', 'h', 'RCA_LEAD', NULL, now()),
      ('00000000-0000-4000-8000-000000000004', 'Dee Dev', 'dev@x.test', 'h', 'DEV', 'DEV', now()),
      ('00000000-0000-4000-8000-000000000005', 'Vic Viewer', 'viewer@x.test', 'h', 'VIEWER', NULL, now());
    INSERT INTO companies (id, name, updated_at) VALUES ('10000000-0000-4000-8000-000000000001', 'Acme', now());
    INSERT INTO projects (id, company_id, name, owner_user_id, updated_at)
      VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Payments', '00000000-0000-4000-8000-000000000002', now());
    INSERT INTO rca (id, rca_number, rca_date, project_id, team_leader_id, severity, environment, incident_start, summary, prepared_by, updated_at) VALUES
      ('30000000-0000-4000-8000-000000000001', 'RCA-2026-0001', '2026-09-01', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'P1', 'PROD', now(), 'First', '00000000-0000-4000-8000-000000000003', now()),
      ('30000000-0000-4000-8000-000000000002', 'RCA-2026-0002', '2026-09-02', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'P2', 'UAT', now(), 'Second', NULL, now());
    INSERT INTO rca_number_seq (year, last_value) VALUES (2026, 2);
    INSERT INTO rca_team_section (id, rca_id, team, contributor_id, updated_at)
      VALUES ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'DEV', '00000000-0000-4000-8000-000000000004', now());
    INSERT INTO rca_signoff (id, rca_id, role, user_id, signed_at, updated_at)
      VALUES ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'DEV_LEAD', '00000000-0000-4000-8000-000000000004', now(), now());
    INSERT INTO audit_log (id, entity, entity_id, rca_id, action, user_id)
      VALUES ('60000000-0000-4000-8000-000000000001', 'rca', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'CREATE', '00000000-0000-4000-8000-000000000003');
  `);
});

afterAll(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
});

describe('B2C migration', () => {
  it('up: personal workspaces, a company workspace with mapped roles, RCAs moved and labels back-filled', async () => {
    await db.query('BEGIN');
    await db.query(UP);
    await db.query('COMMIT');

    const personal = await q<{ n: string }>(`SELECT count(*) n FROM workspaces WHERE is_personal`);
    expect(Number(personal[0].n)).toBe(5);
    const shared = await q<{ id: string; name: string; owner_id: string }>(`SELECT id, name, owner_id FROM workspaces WHERE NOT is_personal`);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ name: 'Acme', owner_id: '00000000-0000-4000-8000-000000000001' });

    const roles = await q<{ email: string; role: string; team: string | null }>(
      `SELECT u.email, m.role, m.team FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY u.email`,
      [shared[0].id],
    );
    expect(roles).toEqual([
      { email: 'admin@x.test', role: 'OWNER', team: null },
      { email: 'dev@x.test', role: 'CONTRIBUTOR', team: 'DEV' },
      { email: 'lead@x.test', role: 'EDITOR', team: null },
      { email: 'owner@x.test', role: 'OWNER', team: null },
      { email: 'viewer@x.test', role: 'VIEWER', team: null },
    ]);

    const rcas = await q(`SELECT rca_number, workspace_id, company_name, project_name, project_owner_name, team_leader_name, prepared_by_name FROM rca ORDER BY rca_number`);
    expect(rcas[0]).toMatchObject({
      rca_number: 'RCA-2026-0001',
      workspace_id: shared[0].id,
      company_name: 'Acme',
      project_name: 'Payments',
      project_owner_name: 'Olga Owner',
      team_leader_name: 'Leo Lead',
      prepared_by_name: 'Leo Lead',
    });
    expect((await q(`SELECT contributor_name FROM rca_team_section`))[0]).toEqual({ contributor_name: 'Dee Dev' });
    expect((await q(`SELECT assignee_user_id FROM rca_signoff`))[0]).toEqual({ assignee_user_id: '00000000-0000-4000-8000-000000000004' });
    expect(await q(`SELECT workspace_id, year, last_value FROM rca_number_seq`)).toEqual([{ workspace_id: shared[0].id, year: 2026, last_value: 2 }]);
    expect((await q(`SELECT workspace_id FROM audit_log`))[0]).toEqual({ workspace_id: shared[0].id });
    expect(Number((await q<{ n: string }>(`SELECT count(*) n FROM users WHERE email_verified_at IS NOT NULL`))[0].n)).toBe(5);
    const cols = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`);
    expect(cols.map((c) => c.column_name)).not.toContain('role');
    expect(await q(`SELECT to_regclass('public.companies') AS t`)).toEqual([{ t: null }]);
  });

  it('up: audit rows stay immutable except anonymisation and explicit purge', async () => {
    await expect(db.query(`UPDATE audit_log SET action = 'X'`)).rejects.toThrow(/cannot be modified/);
    await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/cannot be modified/);
    await expect(db.query(`UPDATE audit_log SET user_id = NULL, action = 'X'`)).rejects.toThrow(/cannot be modified/);
    await db.query('BEGIN');
    await db.query(`UPDATE audit_log SET user_id = NULL`); // anonymisation is allowed
    await db.query('ROLLBACK');
    await db.query('BEGIN');
    await db.query(`SET LOCAL app.audit_purge = 'on'`);
    await db.query(`DELETE FROM audit_log`);
    await db.query('ROLLBACK');
    expect(Number((await q<{ n: string }>(`SELECT count(*) n FROM audit_log`))[0].n)).toBe(1);
  });

  it('down: restores the legacy schema and data', async () => {
    await db.query('BEGIN');
    await db.query(DOWN);
    await db.query('COMMIT');
    const users = await q<{ email: string; role: string; team: string | null }>(`SELECT email, role, team FROM users ORDER BY email`);
    expect(users).toEqual([
      { email: 'admin@x.test', role: 'ADMIN', team: null },
      { email: 'dev@x.test', role: 'DEV', team: 'DEV' },
      { email: 'lead@x.test', role: 'RCA_LEAD', team: null },
      { email: 'owner@x.test', role: 'ADMIN', team: null },
      { email: 'viewer@x.test', role: 'VIEWER', team: null },
    ]);
    const rca = await q(`SELECT r.rca_number, p.name AS project, c.name AS company, r.team_leader_id, r.prepared_by
                         FROM rca r JOIN projects p ON p.id = r.project_id JOIN companies c ON c.id = p.company_id ORDER BY r.rca_number`);
    expect(rca[0]).toMatchObject({
      rca_number: 'RCA-2026-0001',
      project: 'Payments',
      company: 'Acme',
      team_leader_id: '00000000-0000-4000-8000-000000000003',
      prepared_by: '00000000-0000-4000-8000-000000000003',
    });
    expect(await q(`SELECT year, last_value FROM rca_number_seq`)).toEqual([{ year: 2026, last_value: 2 }]);
    expect(await q(`SELECT to_regclass('public.workspaces') AS t`)).toEqual([{ t: null }]);
    await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/cannot be modified/);
    // The legacy schema accepts a re-run of the up migration (round trip).
    await db.query('BEGIN');
    await db.query(UP);
    await db.query('ROLLBACK');
  });
});
