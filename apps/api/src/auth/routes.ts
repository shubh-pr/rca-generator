import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { signAccessToken } from './jwt.js';
import { currentUser, requireAuth } from './middleware.js';
import { verifyPassword } from './password.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/** Public auth routes (mounted before requireAuth). */
export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !user.is_active || !(await verifyPassword(body.password, user.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  const token = signAccessToken({ sub: user.id, role: user.role });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, team: user.team },
  });
});

/** Authenticated "who am I" route. */
export const meRouter = Router();

meRouter.get('/me', requireAuth, (req, res) => {
  res.json(currentUser(req));
});
