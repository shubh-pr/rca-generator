import { prisma } from '../db.js';
import { unscoped } from '../tenancy/context.js';

/** Profile plus workspaces (with the user's role) for the web app. */
export async function meView(userId: string) {
  return unscoped('profile of the current user', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const memberships = await prisma.workspaceMember.findMany({
      where: { user_id: userId },
      include: { workspace: { select: { id: true, name: true, is_personal: true, owner_id: true } } },
      orderBy: { created_at: 'asc' },
    });
    const shared = await prisma.rcaCollaborator.count({ where: { user_id: userId } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      email_verified: !!user.email_verified_at,
      is_platform_admin: user.is_platform_admin,
      onboarded: !!user.onboarded_at,
      has_password: !!user.password_hash,
      shared_rca_count: shared,
      workspaces: memberships
        .map((m) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          is_personal: m.workspace.is_personal,
          is_primary_owner: m.workspace.owner_id === userId,
          role: m.role,
          team: m.team,
        }))
        .sort((a, b) => Number(b.is_personal) - Number(a.is_personal)),
    };
  });
}
