import {closeDatabasePools} from '../lib/database/connection.ts';
import {scheduledRun} from '../lib/importer/scheduled.ts';

try {
  const ran=await scheduledRun(AbortSignal.timeout(5*60*1000));
  if(!ran) console.info(JSON.stringify({event:'scheduled_overlap_skipped'}));
} catch {
  console.error(JSON.stringify({event:'scheduled_job_failed'}));
  process.exitCode=1;
} finally {await closeDatabasePools();}
