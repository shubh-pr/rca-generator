import { prisma } from '../db.js';
import { unscoped } from '../tenancy/context.js';

/** A new user and their personal workspace (they become its OWNER). */
export function createAccount(data: { name: string; email: string; password_hash: string | null; email_verified_at?: Date | null }) {
  return unscoped('create account', () =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      await tx.workspace.create({
        data: { name: `${data.name}'s workspace`.slice(0, 120), owner_id: user.id, is_personal: true, members: { create: { user_id: user.id, role: 'OWNER' } } },
      });
      return user;
    }),
  );
}
