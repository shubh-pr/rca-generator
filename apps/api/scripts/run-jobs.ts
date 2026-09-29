/** Run the scheduled jobs once (for an external cron instead of JOBS_ENABLED):  node dist/scripts/run-jobs.js */
import { disconnectDb } from '../src/db.js';
import { runJobsOnce } from '../src/jobs/index.js';

runJobsOnce()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
