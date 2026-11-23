import { localAdminAllowed } from '../../../../lib/local-admin';
import { importStatus, runImport } from '../../../../lib/importer/runtime';
import { RegistryConflict } from '../../../../lib/registry-file';

export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const hidden=()=>new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});

export async function GET(request:Request) {
  if (!localAdminAllowed(request.headers)) return hidden();
  try { return json({state:await importStatus()}); }
  catch { return json({error:'Import status is unavailable. Check the local checkpoint file.'},503); }
}

export async function POST(request:Request) {
  if (!localAdminAllowed(request.headers,true)) return hidden();
  try { return json(await runImport('now')); }
  catch(error) {
    if (error instanceof RegistryConflict) return json({error:error.message},409);
    return json({error:'Synchronization failed. Check the local import policy, checkpoint, and CLI output.'},503);
  }
}
