/**
 * Idempotent seed: one user per role, one company, one project.
 * Safe to run on every container start. Test passwords are documented in README.md.
 */
import { PrismaClient, type Team, type UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedSampleRcas } from './seedSampleRcas.js';

const prisma = new PrismaClient();

export const SEED_PASSWORD = 'Password@123';

export const SEED_USERS: { name: string; email: string; role: UserRole; team: Team | null }[] = [
  { name: 'System Admin', email: 'admin@rca.local', role: 'ADMIN', team: null },
  { name: 'Jogender Kota', email: 'jogender.kota@rca.local', role: 'PROJECT_OWNER', team: null },
  { name: 'Priya Sharma', email: 'lead@rca.local', role: 'RCA_LEAD', team: null },
  { name: 'Arjun Mehta', email: 'dev@rca.local', role: 'DEV', team: 'DEV' },
  { name: 'Neha Gupta', email: 'qa@rca.local', role: 'QA', team: 'QA' },
  { name: 'Vikram Singh', email: 'prod@rca.local', role: 'PROD', team: 'PROD' },
  { name: 'Asha Rao', email: 'viewer@rca.local', role: 'VIEWER', team: null },
];

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const users: Record<string, { id: string }> = {};
  for (const u of SEED_USERS) {
    users[u.role] = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, password_hash: passwordHash },
    });
  }

  const company = await prisma.company.upsert({
    where: { name: 'Acme Payments Pvt Ltd' },
    update: {},
    create: { name: 'Acme Payments Pvt Ltd' },
  });

  const project = await prisma.project.upsert({
    where: { company_id_name: { company_id: company.id, name: 'Payment Gateway' } },
    update: {},
    create: { company_id: company.id, name: 'Payment Gateway', owner_user_id: users.PROJECT_OWNER.id },
  });

  await seedSampleRcas(prisma, project.id);
  console.log('Seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
