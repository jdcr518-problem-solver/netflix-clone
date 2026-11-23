import type { RegistrySource } from './registry-schema.ts';
import { mutateRegistry, readRegistryFile } from './registry-file.ts';
import type { RegistryCommand } from './registry-mutation.ts';

/** Server/operator storage contract. Never serialize RegistrySource records to public clients. */
export interface RegistryStore {
  readonly kind: 'json' | 'postgres';
  read(target?: {type:'movie'|'tv';id:number}): Promise<RegistrySource[]>;
  mutate(command: RegistryCommand, id: string, patch?: object, expectedVersion?: string): Promise<RegistrySource[]>;
}

export function jsonRegistry(path: string): RegistryStore {
  return {kind:'json', read:async target=>(await readRegistryFile(path)).filter(entry=>!target ||
    entry.target.namespace==='tmdb' && entry.target.tmdbId===target.id && entry.target.type===(target.type==='movie'?'movie':'episode')),
    mutate:(command,id,patch,version)=>mutateRegistry(path,command,id,patch,version)};
}

export function asRegistryStore(value: string | RegistryStore): RegistryStore {
  return typeof value === 'string' ? jsonRegistry(value) : value;
}

export function registryMode(env: Partial<NodeJS.ProcessEnv> = process.env): 'json' | 'postgres' {
  const mode = env.STREAMFRAME_REGISTRY_MODE;
  if (mode === 'postgres') return mode;
  if (env.NODE_ENV === 'production') throw new Error('Production requires STREAMFRAME_REGISTRY_MODE=postgres. JSON fallback is disabled.');
  if (mode === undefined || mode === '' || mode === 'json') return 'json';
  throw new Error('Unsupported STREAMFRAME_REGISTRY_MODE.');
}
