import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { signAccessToken } from './jwt.js';
import { currentUser, requireAuth } from './middleware.js';
import { verifyPassword } from './password.js';
import { meView } from './me.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/** Public auth routes (mounted before requireAuth). */
export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !user.is_active || user.deleted_at || !user.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  const token = signAccessToken({ sub: user.id });
  res.json({ token, user: await meView(user.id) });
});

/** Authenticated "who am I" route. */
export const meRouter = Router();

meRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await meView(currentUser(req).id));
});
