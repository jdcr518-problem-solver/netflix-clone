import { fileURLToPath } from 'node:url';
import { lstat, readFile } from 'node:fs/promises';
import { mutateRegistry, readRegistryFile, type RegistryCommand } from '../lib/registry-file.ts';

const registryPath = fileURLToPath(new URL('../data/sources.local.json', import.meta.url));
const [command, argument, inputFile, extra] = process.argv.slice(2);

async function input(path: string) {
  if (!(await lstat(path)).isFile()) throw new Error('Input must be a regular JSON file.');
  let data: unknown;
  try { data = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Input could not be read as JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Input must be a JSON object.');
  if ('createdAt' in data || 'updatedAt' in data) throw new Error('Timestamps are managed by the registry.');
  return data;
}

async function main() {
  if ((command === 'list' || command === 'validate') && !argument) {
    const sources = await readRegistryFile(registryPath);
    if (command === 'validate') console.log(`Valid registry (${sources.length} sources).`);
    else console.log(JSON.stringify(sources.map(({id,target,format,enabled,label,createdAt,updatedAt}) =>
      ({id,target,format,enabled,label,createdAt,updatedAt})), null, 2));
    return;
  }
  const validArgs = !extra && argument && (
    (['add','remove','enable','disable'].includes(command) && !inputFile) ||
    (command === 'update' && Boolean(inputFile))
  );
  if (!validArgs) throw new Error('Usage: sources list | validate | add <json-file> | update <id> <json-file> | remove <id> | enable <id> | disable <id>');
  if (process.env.NODE_ENV === 'production') throw new Error('Registry changes are disabled in production.');

  const patch = command === 'add' ? await input(argument) : command === 'update' ? await input(inputFile) : undefined;
  await mutateRegistry(registryPath, command as RegistryCommand, argument, patch);
  console.log('Registry saved.');
}

main().catch(error => {
  console.error(error.code ? `Registry operation failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
