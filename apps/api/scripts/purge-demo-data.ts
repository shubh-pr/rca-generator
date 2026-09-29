/**
 * Delete all demo data created by the seed: users with an @rca.local email, every workspace they own
 * (RCAs, sections, files, audit rows) and their memberships. Prints what it will delete and only
 * deletes with --confirm:   npm run purge:demo -- --confirm
 */
import { DEMO_DOMAIN } from '../prisma/demo.js';
import { disconnectDb, prisma } from '../src/db.js';
import { purgeWorkspace, removeStoredFiles } from '../src/services/purge.js';
import { unscoped } from '../src/tenancy/context.js';

export async function purgeDemoData(confirm: boolean, log: (s: string) => void = console.log) {
  return unscoped('purge demo data script', async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true, email: true } });
    const workspaces = await prisma.workspace.findMany({ where: { owner_id: { in: users.map((u) => u.id) } }, select: { id: true, name: true } });
    const rcas = await prisma.rca.count({ where: { workspace_id: { in: workspaces.map((w) => w.id) } } });
    log(`Demo users: ${users.length} (${users.map((u) => u.email).join(', ') || 'none'})`);
    log(`Workspaces owned by them: ${workspaces.length} (${workspaces.map((w) => w.name).join(', ') || 'none'})`);
    log(`RCAs in those workspaces: ${rcas}`);
    if (!confirm) {
      log('Nothing deleted. Re-run with --confirm to delete the data above.');
      return { deleted: false, users: users.length, workspaces: workspaces.length, rcas };
    }
    const files: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const w of workspaces) files.push(...(await purgeWorkspace(tx, w.id)).files);
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`);
      await tx.auditLog.deleteMany({ where: { user_id: { in: users.map((u) => u.id) } } });
      // Rows in other tenants' data keep working with the user reference nulled by the FKs.
      await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    });
    await removeStoredFiles(files);
    log(`Deleted ${users.length} users, ${workspaces.length} workspaces, ${rcas} RCAs, ${files.length} files.`);
    return { deleted: true, users: users.length, workspaces: workspaces.length, rcas };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  purgeDemoData(process.argv.includes('--confirm'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => disconnectDb());
}
