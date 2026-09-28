import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { loadRcaAccess, type RcaAccess } from '../../policy/access.js';
import { parse, zUuid } from '../../lib/validate.js';

declare module 'express-serve-static-core' {
  interface Request {
    rcaAccess?: RcaAccess;
  }
}

/**
 * Runs before every /rcas/:id… route: resolves the user's access (404 when the RCA is not visible)
 * so no RCA route can skip the tenant and role check.
 */
export async function rcaAccessMiddleware(req: Request, _res: Response, next: NextFunction) {
  const { id } = parse(z.object({ id: zUuid }), { id: req.params.id });
  req.rcaAccess = await loadRcaAccess(prisma, currentUser(req), id);
  next();
}

export function rcaOf(req: Request): RcaAccess {
  if (!req.rcaAccess) throw new Error('rcaAccessMiddleware did not run for this route');
  return req.rcaAccess;
}
