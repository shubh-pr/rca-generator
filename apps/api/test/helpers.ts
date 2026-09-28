import type { Team, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/jwt.js';
import { prisma } from '../src/db.js';

export const app = createApp();
export const api = () => request(app);
export { prisma };

export const PASSWORD = 'Password@123';

const TABLES = [
  'audit_log',
  'rca_signoff',
  'rca_attachment',
  'rca_followup',
  'rca_action',
  'rca_why',
  'rca_team_section',
  'rca_timeline',
  'rca',
  'rca_number_seq',
  'projects',
  'companies',
  'users',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export type RoleKey = 'ADMIN' | 'PROJECT_OWNER' | 'RCA_LEAD' | 'DEV' | 'QA' | 'PROD' | 'VIEWER';
export const ROLE_KEYS: RoleKey[] = ['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER'];

export interface Actor {
  id: string;
  email: string;
  role: UserRole;
  token: string;
}

let hash: string | undefined;

/** One active user per role, with a ready bearer token. */
export async function createActors(): Promise<Record<RoleKey, Actor>> {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  const out = {} as Record<RoleKey, Actor>;
  for (const role of ROLE_KEYS) {
    const team: Team | null = role === 'DEV' || role === 'QA' || role === 'PROD' ? role : null;
    const email = `${role.toLowerCase()}@test.local`;
    const user = await prisma.user.create({
      data: { name: `${role} User`, email, role, team, password_hash: hash },
    });
    out[role] = { id: user.id, email, role, token: signAccessToken({ sub: user.id, role }) };
  }
  return out;
}

/** Company + project owned by the PROJECT_OWNER actor. */
export async function createProject(ownerId: string, name = 'Payment Gateway') {
  const company = await prisma.company.create({ data: { name: `Company for ${name}` } });
  const project = await prisma.project.create({ data: { company_id: company.id, name, owner_user_id: ownerId } });
  return { company, project };
}

export const bearer = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
