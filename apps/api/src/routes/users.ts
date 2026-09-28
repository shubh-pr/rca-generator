import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser, hashPassword } from '../auth/index.js';
import { prisma } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { can, ensure, TEAM_OF_ROLE } from '../lib/permissions.js';
import { idParam, parse } from '../lib/validate.js';

export const usersRouter = Router();

const ROLES = ['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER'] as const;
const TEAMS = ['DEV', 'QA', 'PROD'] as const;

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  team: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.UserSelect;

const baseFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(180),
  role: z.enum(ROLES),
  team: z.enum(TEAMS).nullable().optional(),
  is_active: z.boolean().optional(),
};

const createSchema = z.object({ ...baseFields, password: z.string().min(8, 'At least 8 characters') });
const updateSchema = z
  .object({ ...baseFields, password: z.string().min(8, 'At least 8 characters') })
  .partial();

/** Dev/QA/Prod users must have their matching team; other roles have none. */
function resolveTeam(role: (typeof ROLES)[number], team: string | null | undefined) {
  const required = TEAM_OF_ROLE[role];
  if (required) {
    if (team && team !== required) throw badRequest({ team: `Role ${role} must have team ${required}` });
    return required;
  }
  if (team) throw badRequest({ team: `Role ${role} has no team` });
  return null;
}

const listQuery = z.object({
  q: z.string().optional(),
  role: z.enum(ROLES).optional(),
  team: z.enum(TEAMS).optional(),
  is_active: z.enum(['true', 'false']).optional(),
});

// Any logged-in user can read users (needed for owner / leader pickers); only Admin can change them.
usersRouter.get('/users', async (req, res) => {
  const q = parse(listQuery, req.query);
  const p = parsePage(req.query, ['name', 'email', 'role', 'created_at'], 'name');
  const where: Prisma.UserWhereInput = {
    role: q.role,
    team: q.team,
    is_active: q.is_active === undefined ? undefined : q.is_active === 'true',
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { email: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.user.findMany({ where, select: publicUser, orderBy: p.orderBy, skip: p.skip, take: p.take }),
    prisma.user.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

usersRouter.get('/users/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const user = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!user) throw notFound('User not found');
  res.json(user);
});

usersRouter.post('/users', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const body = parse(createSchema, req.body);
  const team = resolveTeam(body.role, body.team);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('A user with this email already exists');
  }
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: body.name,
        email: body.email,
        role: body.role,
        team,
        is_active: body.is_active ?? true,
        password_hash: await hashPassword(body.password),
      },
      select: publicUser,
    });
    await writeAudit(tx, { entity: 'users', entity_id: created.id, action: 'CREATE', new_value: created, user_id: me.id });
    return created;
  });
  res.status(201).json(user);
});

usersRouter.patch('/users/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  const body = parse(updateSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!existing) throw notFound('User not found');
  const role = body.role ?? existing.role;
  const team = resolveTeam(role, body.team === undefined && body.role === undefined ? existing.team : body.team);
  if (body.email && body.email !== existing.email && (await prisma.user.findUnique({ where: { email: body.email } }))) {
    throw conflict('A user with this email already exists');
  }
  if (id === me.id && (body.is_active === false || (body.role && body.role !== 'ADMIN'))) {
    throw badRequest({ role: 'You cannot deactivate or demote your own account' });
  }
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        name: body.name,
        email: body.email,
        role: body.role,
        team,
        is_active: body.is_active,
        ...(body.password ? { password_hash: await hashPassword(body.password) } : {}),
      },
      select: publicUser,
    });
    const changes = diff(existing, updated);
    if (body.password) changes.new_value.password = '(changed)';
    await writeAudit(tx, { entity: 'users', entity_id: id, action: 'UPDATE', ...changes, user_id: me.id });
    return updated;
  });
  res.json(user);
});

// Users are referenced by RCAs and audit rows, so "delete" deactivates.
usersRouter.delete('/users/:id', async (req, res) => {
  const me = currentUser(req);
  ensure(can.manageMasters(me));
  const { id } = parse(idParam, req.params);
  if (id === me.id) throw badRequest({ id: 'You cannot deactivate your own account' });
  const existing = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!existing) throw notFound('User not found');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { is_active: false } });
    await writeAudit(tx, {
      entity: 'users',
      entity_id: id,
      action: 'DELETE',
      old_value: { is_active: existing.is_active },
      new_value: { is_active: false },
      user_id: me.id,
    });
  });
  res.status(204).end();
});
