import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse } from '../lib/validate.js';

export const companiesRouter = Router();

const bodySchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(150) });

companiesRouter.get('/companies', async (req, res) => {
  const q = parse(z.object({ q: z.string().optional() }), { q: req.query.q });
  const p = parsePage(req.query, ['name', 'created_at'], 'name');
  const where: Prisma.CompanyWhereInput = q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {};
  const [data, total] = await Promise.all([
    prisma.company.findMany({ where, orderBy: p.orderBy, skip: p.skip, take: p.take }),
    prisma.company.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

companiesRouter.get('/companies/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) throw notFound('Company not found');
  res.json(company);
});

async function ensureUniqueName(name: string, exceptId?: string) {
  const clash = await prisma.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined } });
  if (clash) throw conflict('A company with this name already exists');
}

companiesRouter.post('/companies', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const body = parse(bodySchema, req.body);
  await ensureUniqueName(body.name);
  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({ data: body });
    await writeAudit(tx, { entity: 'companies', entity_id: created.id, action: 'CREATE', new_value: created, user_id: me.id });
    return created;
  });
  res.status(201).json(company);
});

companiesRouter.patch('/companies/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  const body = parse(bodySchema.partial(), req.body);
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) throw notFound('Company not found');
  if (body.name) await ensureUniqueName(body.name, id);
  const company = await prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id }, data: body });
    await writeAudit(tx, { entity: 'companies', entity_id: id, action: 'UPDATE', ...diff(existing, updated), user_id: me.id });
    return updated;
  });
  res.json(company);
});

companiesRouter.delete('/companies/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) throw notFound('Company not found');
  if (await prisma.project.count({ where: { company_id: id } })) {
    throw conflict('Company still has projects');
  }
  await prisma.$transaction(async (tx) => {
    await tx.company.delete({ where: { id } });
    await writeAudit(tx, { entity: 'companies', entity_id: id, action: 'DELETE', old_value: existing, user_id: me.id });
  });
  res.status(204).end();
});
