import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse, zUuid } from '../lib/validate.js';

export const projectsRouter = Router();

const include = {
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ProjectInclude;

const bodySchema = z.object({
  company_id: zUuid,
  name: z.string().trim().min(1, 'Name is required').max(150),
  owner_user_id: zUuid,
});

projectsRouter.get('/projects', async (req, res) => {
  const q = parse(z.object({ q: z.string().optional(), company_id: zUuid.optional() }), {
    q: req.query.q,
    company_id: req.query.company_id,
  });
  const p = parsePage(req.query, ['name', 'created_at'], 'name');
  const where: Prisma.ProjectWhereInput = {
    company_id: q.company_id,
    ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.project.findMany({ where, include, orderBy: p.orderBy, skip: p.skip, take: p.take }),
    prisma.project.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

projectsRouter.get('/projects/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const project = await prisma.project.findUnique({ where: { id }, include });
  if (!project) throw notFound('Project not found');
  res.json(project);
});

async function checkRefs(body: Partial<z.infer<typeof bodySchema>>) {
  const fields: Record<string, string> = {};
  if (body.company_id && !(await prisma.company.findUnique({ where: { id: body.company_id } }))) {
    fields.company_id = 'Company does not exist';
  }
  if (body.owner_user_id) {
    const owner = await prisma.user.findUnique({ where: { id: body.owner_user_id } });
    if (!owner || !owner.is_active) fields.owner_user_id = 'Owner must be an active user';
  }
  if (Object.keys(fields).length) throw badRequest(fields);
}

async function ensureUniqueName(companyId: string, name: string, exceptId?: string) {
  const clash = await prisma.project.findFirst({
    where: { company_id: companyId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
  });
  if (clash) throw conflict('This company already has a project with this name');
}

projectsRouter.post('/projects', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const body = parse(bodySchema, req.body);
  await checkRefs(body);
  await ensureUniqueName(body.company_id, body.name);
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({ data: body, include });
    await writeAudit(tx, { entity: 'projects', entity_id: created.id, action: 'CREATE', new_value: body, user_id: me.id });
    return created;
  });
  res.status(201).json(project);
});

projectsRouter.patch('/projects/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  const body = parse(bodySchema.partial(), req.body);
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw notFound('Project not found');
  await checkRefs(body);
  if (body.name || body.company_id) {
    await ensureUniqueName(body.company_id ?? existing.company_id, body.name ?? existing.name, id);
  }
  const project = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id }, data: body, include });
    const { company: _c, owner: _o, ...plain } = updated;
    await writeAudit(tx, { entity: 'projects', entity_id: id, action: 'UPDATE', ...diff(existing, plain), user_id: me.id });
    return updated;
  });
  res.json(project);
});

projectsRouter.delete('/projects/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw notFound('Project not found');
  if (await prisma.rca.count({ where: { project_id: id } })) {
    throw conflict('Project still has RCAs');
  }
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } });
    await writeAudit(tx, { entity: 'projects', entity_id: id, action: 'DELETE', old_value: existing, user_id: me.id });
  });
  res.status(204).end();
});
