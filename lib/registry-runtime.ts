import 'server-only';
import { join } from 'node:path';
import { jsonRegistry, registryMode, type RegistryStore } from './registry-store.ts';
import { databasePool } from './database/connection.ts';
import { PostgresRegistry } from './database/registry.ts';

export const registryPath=join(process.cwd(),'data','sources.local.json');
export function readerRegistry():RegistryStore {
  return registryMode()==='json' ? jsonRegistry(registryPath) : new PostgresRegistry(databasePool('reader'),'reader');
}
/** Import only from private operator entrypoints. The web runtime needs no write URL. */
export function operatorRegistry():RegistryStore {
  if(registryMode()==='json') return jsonRegistry(registryPath);
  const actor=process.env.STREAMFRAME_OPERATOR_ID;
  if(!actor) throw new Error('STREAMFRAME_OPERATOR_ID is required for database writes.');
  return new PostgresRegistry(databasePool('operator'),'operator',actor);
}
