import { loadEnvFile } from 'node:process';
import {closeDatabasePools} from '../lib/database/connection.ts';
import {runSupplierPackage} from '../lib/importer/package-runtime.ts';

async function main() {
  const [path,option,extra]=process.argv.slice(2);
  if (!path || extra || (option && option!=='--publish')) throw new Error('Usage: npm run sources:package -- <manifest.json> [--publish]');
  try { if(process.env.NODE_ENV!=='production') loadEnvFile('.env.local'); } catch(error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  const result=await runSupplierPackage(path,option==='--publish',AbortSignal.timeout(30*60*1000));
  console.log(JSON.stringify(result,null,2));
}

main().catch(error=>{
  if(process.env.NODE_ENV==='production') console.error('Supplier package operation failed.');
  else console.error(error instanceof SyntaxError ? 'Invalid package JSON.' : error.code ? `Package operation failed (${error.code}).` : error.message);
  process.exitCode=1;
}).finally(closeDatabasePools);
