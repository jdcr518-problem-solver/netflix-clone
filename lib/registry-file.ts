import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateRegistry, type RegistrySource } from './registry-schema.ts';

import { applyRegistryMutation, RegistryConflict, type RegistryCommand } from './registry-mutation.ts';
export { RegistryConflict, type RegistryCommand } from './registry-mutation.ts';

export async function readRegistryFile(registryPath: string): Promise<RegistrySource[]> {
  try {
    if (!(await lstat(registryPath)).isFile()) throw new Error('Registry must be a regular file.');
    let value: unknown;
    try {
      value = JSON.parse((await readFile(registryPath, 'utf8')).replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('Registry could not be read as JSON.');
    }
    return validateRegistry(value, 'tmdb');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRegistry(registryPath: string, sources: RegistrySource[]) {
  const value = {version:1, sources};
  validateRegistry(value, 'tmdb');
  const temporary = `${registryPath}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, registryPath);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function mutateRegistry(registryPath: string, command: RegistryCommand,
  argument: string, patch?: object, expectedVersion?: string) {
  if (process.env.NODE_ENV === 'production') throw new Error('Registry changes are disabled in production.');
  const lockPath = registryPath + '.lock';
  const lock = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new RegistryConflict('Registry is busy. Try again.');
    throw error;
  });
  try {
    const sources = await readRegistryFile(registryPath);
    const next = applyRegistryMutation(sources, command, argument, patch, expectedVersion);
    await writeRegistry(registryPath, next);
    return next;
  } finally {
    try { await lock.close(); }
    finally { await unlink(lockPath); }
  }
}
