import { localAdminAllowed } from '../../../../lib/local-admin';
import { mutateRegistry, readRegistryFile, RegistryConflict } from '../../../../lib/registry-file';
import { registryPath } from '../../../../lib/source-registry';

export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, {status,headers:{'Cache-Control':'no-store'}});
const hidden = () => new Response(null, {status:404,headers:{'Cache-Control':'no-store'}});

export async function GET(request: Request) {
  if (!localAdminAllowed(request.headers)) return hidden();
  try { return json({sources:await readRegistryFile(registryPath)}); }
  catch { return json({error:'The registry cannot be read. Repair it with the local CLI before editing.'}, 503); }
}

export async function POST(request: Request) {
  if (!localAdminAllowed(request.headers,true)) return hidden();
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({error:'A JSON request is required.'},400);
    const decoder = new TextDecoder();
    let text = '', size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return json({error:'Request is too large.'},413);
      }
      text += decoder.decode(chunk.value,{stream:true});
    }
    body = JSON.parse(text+decoder.decode());
  } catch { return json({error:'Invalid JSON request.'},400); }
  const command = body?.command;
  if (command !== 'add' && command !== 'update' && command !== 'enable' && command !== 'disable' && command !== 'remove')
    return json({error:'Unknown registry action.'},400);
  if (command !== 'add' && (typeof body.id !== 'string' || typeof body.version !== 'string'))
    return json({error:'A source ID and version are required.'},400);
  const patch = body.patch;
  if ((command === 'add' || command === 'update') && (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
    'createdAt' in patch || 'updatedAt' in patch || 'provenance' in patch || 'supplierRelease' in patch))
    return json({error:'Provide valid source fields without timestamps.'},400);
  try {
    return json({sources:await mutateRegistry(registryPath,command,body.id,patch,command === 'add' ? undefined : body.version)});
  } catch (error) {
    if (error instanceof RegistryConflict) return json({error:error.message},409);
    const message = error instanceof Error ? error.message : '';
    if (/^Source #\d+: invalid duplicate source ID\.$/.test(message))
      return json({error:'This source ID already exists.'},409);
    if (/^Source #\d+: (invalid |unexpected fields\.)/.test(message) || /^A source (ID|target) cannot change/.test(message) || message.startsWith('Provider playback'))
      return json({error:message},400);
    return json({error:'The registry could not be saved. Check it with the local CLI.'},503);
  }
}
