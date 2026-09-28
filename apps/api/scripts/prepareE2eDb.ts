/**
 * Prepare the dedicated end-to-end database: create it if needed, apply migrations,
 * wipe data, and run the normal seed. Refuses any database not named *_e2e.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
const dbName = url ? new URL(url).pathname.slice(1) : '';
if (!dbName.endsWith('_e2e')) throw new Error(`E2E DATABASE_URL must point to a *_e2e database, got "${url}"`);

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
await admin.$disconnect();

const cwd = path.resolve(import.meta.dirname, '..');
execSync('npx prisma migrate deploy', { cwd, stdio: 'inherit' });

const db = new PrismaClient();
const tables = await db.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
await db.$disconnect();
execSync('npx prisma db seed', { cwd, stdio: 'inherit' });
