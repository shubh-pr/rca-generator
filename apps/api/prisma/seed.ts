/**
 * Demo seed for local development ONLY. Runs when NODE_ENV=development and SEED_DEMO=true; otherwise
 * it does nothing, so a production database never gets demo data. Idempotent.
 * Remove demo data later with `npm run purge:demo -- --confirm`.
 */
import type { Team, WorkspaceRole } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';
import { disconnectDb, prisma } from '../src/db.js';
import { createClosedSample, createDraftSample } from '../src/services/sampleData.js';
import { unscoped } from '../src/tenancy/context.js';

import { DEMO_DOMAIN, DEMO_PASSWORD } from './demo.js';

interface DemoUser {
  key: 'owner' | 'lead' | 'DEV' | 'QA' | 'PROD' | 'viewer' | 'admin';
  name: string;
  email: string;
  role?: WorkspaceRole;
  team?: Team;
}

const USERS: DemoUser[] = [
  { key: 'owner', name: 'Jogender Kota', email: `jogender.kota${DEMO_DOMAIN}`, role: 'OWNER' },
  { key: 'lead', name: 'Priya Sharma', email: `lead${DEMO_DOMAIN}`, role: 'EDITOR' },
  { key: 'DEV', name: 'Arjun Mehta', email: `dev${DEMO_DOMAIN}`, role: 'CONTRIBUTOR', team: 'DEV' },
  { key: 'QA', name: 'Neha Gupta', email: `qa${DEMO_DOMAIN}`, role: 'CONTRIBUTOR', team: 'QA' },
  { key: 'PROD', name: 'Vikram Singh', email: `prod${DEMO_DOMAIN}`, role: 'CONTRIBUTOR', team: 'PROD' },
  { key: 'viewer', name: 'Asha Rao', email: `viewer${DEMO_DOMAIN}`, role: 'VIEWER' },
  // Platform operator (support access only); not a member of the demo workspace.
  { key: 'admin', name: 'Site Operator', email: `admin${DEMO_DOMAIN}` },
];

async function main() {
  if (process.env.NODE_ENV !== 'development' || process.env.SEED_DEMO !== 'true') {
    console.log('Seed skipped (demo data only runs with NODE_ENV=development and SEED_DEMO=true)');
    return;
  }
  await unscoped('demo seed', async () => {
    const hash = await hashPassword(DEMO_PASSWORD);
    const users = {} as Record<DemoUser['key'], { id: string; name: string }>;
    for (const u of USERS) {
      const user = await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { name: u.name, email: u.email, password_hash: hash, email_verified_at: new Date(), onboarded_at: new Date(), is_platform_admin: u.key === 'admin' },
      });
      users[u.key] = user;
      if (!(await prisma.workspace.findFirst({ where: { owner_id: user.id, is_personal: true } }))) {
        await prisma.workspace.create({
          data: { name: `${u.name}'s workspace`, owner_id: user.id, is_personal: true, members: { create: { user_id: user.id, role: 'OWNER' } } },
        });
      }
    }
    let demo = await prisma.workspace.findFirst({ where: { owner_id: users.owner.id, name: 'Acme Payments (demo)' } });
    if (!demo) {
      demo = await prisma.workspace.create({ data: { name: 'Acme Payments (demo)', owner_id: users.owner.id } });
      for (const u of USERS.filter((x) => x.role)) {
        await prisma.workspaceMember.create({ data: { workspace_id: demo.id, user_id: users[u.key].id, role: u.role!, team: u.team ?? null } });
      }
    }
    if ((await prisma.rca.count({ where: { workspace_id: demo.id } })) === 0) {
      const people = { owner: users.owner, lead: users.lead, DEV: users.DEV, QA: users.QA, PROD: users.PROD };
      await prisma.$transaction(async (tx) => {
        await createClosedSample(tx, demo!.id, people);
        await createDraftSample(tx, demo!.id, people);
      });
    }
  });
  console.log('Demo seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => disconnectDb());
