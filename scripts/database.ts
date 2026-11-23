import { productionOperation } from '../lib/operations.ts';
import { loadEnvFile } from 'node:process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databasePool, closeDatabasePools } from '../lib/database/connection.ts';
import { migrateDatabase } from '../lib/database/migrations.ts';
import { PostgresRegistry } from '../lib/database/registry.ts';
import { readRegistryFile } from '../lib/registry-file.ts';
import type { RegistryCommand } from '../lib/registry-mutation.ts';

async function main() {
  try {if(process.env.NODE_ENV!=='production') loadEnvFile('.env.local');} catch(error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
  const args=process.argv.slice(2);
  const apply=args.includes('--apply');
  const positional=args.filter(arg=>arg!=='--apply');
  const [command,id,file,extra]=positional;
  if(extra || args.filter(arg=>arg==='--apply').length>1) throw new Error('Invalid arguments.');
  if(command==='schema' && !id) {
    console.log(JSON.stringify(await migrateDatabase(databasePool('migrator'),apply),null,2)); return;
  }
  const actor=process.env.STREAMFRAME_OPERATOR_ID ?? (process.env.NODE_ENV==='production' || process.env.STREAMFRAME_PRINCIPAL_KIND ? 'worker' : undefined);
  if(!actor) throw new Error('STREAMFRAME_OPERATOR_ID is required.');
  const store=new PostgresRegistry(databasePool('operator'),'operator',actor);
  if(command==='migrate-json' && !file) {
    await productionOperation('migrate');
    const records=await readRegistryFile(id ?? join(process.cwd(),'data','sources.local.json'));
    const result=await store.migrate(records,apply);
    console.log(JSON.stringify(result,null,2));
    if(result.conflicts.length) process.exitCode=1;
  } else if(command==='rollback-import' && id && !file) {
    const result=await store.rollbackMigration(id,apply);
    console.log(JSON.stringify(result,null,2));
    if(result.conflicts.length) process.exitCode=1;
  } else if((command==='list' || command==='validate') && !id && !apply) {
    const records=await store.read();
    console.log(JSON.stringify(command==='validate' ? {valid:true,sources:records.length} :
      records.map(({id,target,enabled,format,updatedAt})=>({id,target,enabled,format,updatedAt})),null,2));
  } else if(command==='checkpoint' && id && !file && !apply) {
    const state=await store.checkpoint(id);
    console.log(JSON.stringify({configHash:state.configHash,nextScope:state.nextScope,cursors:state.cursors,runs:state.history.length},null,2));
  } else if(['add','update','disable','enable','remove','revoke'].includes(command) && id) {
    await productionOperation(command==='enable'?'publish':['revoke','remove','disable'].includes(command)?'disable':'edit');
    if(!apply) throw new Error('Operator mutations require --apply. Review the source with list first.');
    if(command==='revoke') {
      if(!file) throw new Error('Provide a revocation reason.');
      await store.revoke(id,file);
    } else {
      if(command==='update' && !file || command!=='update' && file) throw new Error('Invalid source command arguments.');
      let patch:object|undefined;
      if(command==='add' || command==='update') {
        const path=command==='add'?id:file!;
        const info=await lstat(path);
        if(!info.isFile() || info.size>32768) throw new Error('Source input must be a regular JSON file up to 32 KB.');
        patch=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
        if(!patch || Array.isArray(patch) || typeof patch!=='object' ||
          ['createdAt','updatedAt','provenance','supplierRelease'].some(key=>key in patch!))
          throw new Error('Source edits cannot set timestamps or approve content. Use the reviewed importers.');
      }
      await store.mutate(command as RegistryCommand,id,patch);
    }
    console.log('Operator change committed with audit event.');
  } else throw new Error('Usage: database schema | migrate-json [file] | rollback-import <batch> | list | validate | checkpoint <id> | add <file> | update <id> <file> | enable|disable|remove <id> | revoke <id> <reason>. Writes require --apply; schema and migration default to dry-run.');
}

main().catch(()=>{
  // PG error detail and connection errors can include credentials or private records.
  console.error('Database command failed. Check configuration, command arguments, permissions, migration state, and input validation. No database details were logged.');
  process.exitCode=1;
}).finally(closeDatabasePools);
