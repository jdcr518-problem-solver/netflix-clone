import 'server-only';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transaction, type SqlPool } from './connection.ts';

export async function migrateDatabase(pool:SqlPool,apply=false) {
  const migrations=await Promise.all(['001_registry.sql','002_media_urls.sql'].map(async name=>{
    const sql=(await readFile(new URL(`../../db/migrations/${name}`,import.meta.url),'utf8')).replace(/\r\n/g,'\n');
    return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};
  }));
  return transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(1937006962, 8)');
    const exists=await client.query("SELECT to_regclass('streamframe.schema_migrations') AS relation");
    const previous=exists.rows[0].relation ? (await client.query('SELECT name,checksum FROM streamframe.schema_migrations ORDER BY name')).rows : [];
    if(previous.some((row,index)=>row.name!==migrations[index]?.name || row.checksum!==migrations[index]?.checksum)) throw new Error('Unknown or modified database migration; operator review required.');
    const remaining=migrations.slice(previous.length);
    const pending=remaining.map(migration=>migration.name);
    if(apply && pending.length) {
      for(const {name,sql,checksum} of remaining) {
      await client.query(sql);
      if(name==='001_registry.sql') await client.query('CREATE TABLE streamframe.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
      await client.query('REVOKE ALL ON streamframe.schema_migrations FROM PUBLIC');
      await client.query('INSERT INTO streamframe.schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
      }
    }
    return {pending,applied:apply?pending:[]};
  });
}
