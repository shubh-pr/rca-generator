import { config } from '../config.js';
import { logger } from '../lib/logger.js';

import { purgeDueAccounts } from '../services/lifecycle.js';

/** Scheduled background jobs (in-process; run on JOBS_INTERVAL_MINUTES). */
type Job = { name: string; run: () => Promise<unknown> };
const jobs: Job[] = [{ name: 'purge-deleted-accounts', run: () => purgeDueAccounts() }];
let timer: NodeJS.Timeout | undefined;

export function registerJob(job: Job) {
  jobs.push(job);
}

export async function runJobsOnce() {
  for (const job of jobs) {
    try {
      const result = await job.run();
      logger.info('job finished', { job: job.name, result });
    } catch (err) {
      logger.error('job failed', { job: job.name, error: String(err) });
    }
  }
}

export function startJobs() {
  if (!config.jobs.enabled || timer) return;
  timer = setInterval(() => void runJobsOnce(), config.jobs.intervalMs);
  timer.unref();
  setTimeout(() => void runJobsOnce(), 30_000).unref();
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
