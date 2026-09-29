import { Router } from 'express';
import { currentUser } from '../auth/index.js';
import { usageReport } from '../services/quota.js';

/** The current user's own data: usage (export, deletion and security log come with the lifecycle phase). */
export const meDataRouter = Router();

meDataRouter.get('/me/usage', async (req, res) => {
  res.json(await usageReport(currentUser(req).id));
});
