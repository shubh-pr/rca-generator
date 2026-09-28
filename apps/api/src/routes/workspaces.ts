import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validate.js';

export const workspacesRouter = Router();

workspacesRouter.get('/workspaces', async (req, res) => {
  const me = currentUser(req);
  const rows = await prisma.workspaceMember.findMany({
    where: { user_id: me.id },
    include: { workspace: { select: { id: true, name: true, is_personal: true, owner_id: true, plan: true } } },
    orderBy: { created_at: 'asc' },
  });
  res.json({ data: rows.map((m) => ({ ...m.workspace, role: m.role, team: m.team })) });
});

/** Company and project names already used in the workspace, for autocomplete. */
workspacesRouter.get('/workspaces/:wid/labels', async (req, res) => {
  const { wid } = parse(z.object({ wid: zUuid }), req.params);
  const ws = await prisma.workspace.findFirst({ where: { id: wid } });
  if (!ws) throw notFound('Workspace not found');
  const [companies, projects] = await Promise.all([
    prisma.rca.findMany({ where: { workspace_id: wid, company_name: { not: null } }, distinct: ['company_name'], select: { company_name: true }, take: 200 }),
    prisma.rca.findMany({ where: { workspace_id: wid, project_name: { not: null } }, distinct: ['project_name'], select: { project_name: true }, take: 200 }),
  ]);
  res.json({
    companies: companies.map((c) => c.company_name!).sort(),
    projects: projects.map((p) => p.project_name!).sort(),
  });
});
