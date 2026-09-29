/**
 * Make an existing, verified account the platform operator:  npm run admin:promote -- you@example.com
 * (use --revoke to remove the flag). Platform admins see account metadata only; RCA content requires
 * an audited support grant.
 */
import { disconnectDb, prisma } from '../src/db.js';
import { unscoped } from '../src/tenancy/context.js';

const email = process.argv.slice(2).find((a) => !a.startsWith('--'))?.toLowerCase();
const revoke = process.argv.includes('--revoke');

async function main() {
  if (!email) throw new Error('Usage: npm run admin:promote -- <email> [--revoke]');
  await unscoped('promote platform admin', async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account with email ${email}`);
    if (!revoke && !user.email_verified_at) throw new Error('Verify the email address of this account first');
    await prisma.user.update({ where: { id: user.id }, data: { is_platform_admin: !revoke } });
    console.log(`${email} is ${revoke ? 'no longer' : 'now'} a platform admin`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
