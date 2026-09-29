import { beforeAll, describe, expect, it } from 'vitest';
import { purgeDemoData } from '../scripts/purge-demo-data.js';
import { DEMO_DOMAIN } from '../prisma/demo.js';
import { createClosedSample } from '../src/services/sampleData.js';
import { addMember, createRca, createUser, db, raw, resetDb, type Actor } from './helpers.js';

let demo: Actor;
let real: Actor;

beforeAll(async () => {
  await resetDb();
  demo = await createUser('Demo Owner', { email: `owner${DEMO_DOMAIN}` });
  real = await createUser('Real User');
  await raw(() => db.$transaction((tx) => createClosedSample(tx, demo.personalWorkspaceId, { owner: demo, lead: demo, DEV: demo, QA: demo, PROD: demo })));
  await createRca(real, real.personalWorkspaceId);
  // A demo user who was added to a real user's workspace loses only the membership.
  await addMember(real.personalWorkspaceId, demo, 'VIEWER');
});

describe('purge-demo-data script', () => {
  it('refuses to delete without --confirm', async () => {
    const lines: string[] = [];
    const res = await purgeDemoData(false, (l) => lines.push(l));
    expect(res).toMatchObject({ deleted: false, users: 1, workspaces: 1, rcas: 1 });
    expect(lines.join('\n')).toContain('--confirm');
    expect(await raw(() => db.user.count())).toBe(2);
  });

  it('with --confirm deletes demo users, their workspaces, RCAs and audit rows, and keeps real data', async () => {
    const res = await purgeDemoData(true, () => {});
    expect(res.deleted).toBe(true);
    const users = await raw(() => db.user.findMany());
    expect(users.map((u) => u.email)).toEqual([real.email]);
    expect(await raw(() => db.rca.count())).toBe(1);
    expect(await raw(() => db.workspace.count())).toBe(1);
    expect(await raw(() => db.auditLog.count({ where: { workspace_id: demo.personalWorkspaceId } }))).toBe(0);
    expect(await raw(() => db.workspaceMember.count({ where: { workspace_id: real.personalWorkspaceId } }))).toBe(1);
  });
});
