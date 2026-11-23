import { loadEnvFile } from 'node:process';
import { runImport } from '../lib/importer/runtime.ts';

const stop=new AbortController();
const cancel=()=>stop.abort();
process.on('SIGINT',cancel);
process.on('SIGTERM',cancel);

try {
  try {loadEnvFile('.env.local');} catch(error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
  const args=process.argv.slice(2);
  if(args.length>1 || (args.length===1 && args[0]!=='--now')) throw new Error('Usage: npm run sources:sync [-- --now]');
  const result=await runImport(args[0]==='--now'?'now':'due',stop.signal);
  console.log(JSON.stringify(result.skipped ? {skipped:true,reason:'Minimum sync interval has not elapsed.'} : result.state.history[0],null,2));
  if (!result.skipped && result.state.history[0]?.status==='partial') process.exitCode=1;
} catch(error) {
  console.error(error instanceof SyntaxError ? 'Invalid JSON in the local import policy or checkpoint.' : error instanceof Error ? error.message : 'Synchronization failed.');
  process.exitCode=1;
} finally {
  process.off('SIGINT',cancel);
  process.off('SIGTERM',cancel);
}
