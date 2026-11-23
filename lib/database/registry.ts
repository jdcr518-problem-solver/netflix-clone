import 'server-only';
import {productionOperation,type Operation} from '../operations.ts';
import { createHash, randomUUID } from 'node:crypto';
import { validateRegistry, validReleaseReview, type RegistrySource } from '../registry-schema.ts';
import { applyRegistryMutation, RegistryConflict, type RegistryCommand } from '../registry-mutation.ts';
import type { RegistryStore } from '../registry-store.ts';
import { transaction, type SqlClient, type SqlPool } from './connection.ts';
import { emptyImportState, validateImportState } from '../importer/state.ts';
import type { ImportState } from '../importer/sync.ts';

export function canonical(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined)
    .sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const approved=(entry:RegistrySource)=>!!entry.supplierRelease || !!(entry.provenance?.status==='approved' && validReleaseReview(entry.provenance.releaseReview));
function rejectEmbeddedSecrets(value:unknown):void {
  if (typeof value==='string') {
    if (/-----BEGIN .*PRIVATE KEY-----|\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|(?:^|\s)[A-Za-z]:[\\/]|(?:api[_-]?key|token|password|secret|signature|credential)\s*[=:]\s*\S+/i.test(value))
      throw new Error('Registry data contains a credential or local path; remove it before database import.');
    if (/^https?:\/\//i.test(value)) {
      const url=new URL(value);
      if(url.username || url.password || [...url.searchParams.keys()].some(key=>/token|key|sign|credential|auth|secret/i.test(key)))
        throw new Error('Credentials and signed evidence URLs cannot be stored in registry records.');
    }
  } else if (value && typeof value==='object') for(const item of Object.values(value)) rejectEmbeddedSecrets(item);
}
const sameEdition=(a:RegistrySource,b:RegistrySource)=>{
  const {createdAt:ac,updatedAt:au,enabled:ae,...left}=a;
  const {createdAt:bc,updatedAt:bu,enabled:be,...right}=b;
  return canonical(left)===canonical(right);
};

export interface ImportSession {
  store: RegistryStore;
  read():Promise<ImportState>;
  save(state:ImportState):Promise<void>;
  publish(patch:object,state:ImportState):Promise<void>;
}

export class PostgresRegistry implements RegistryStore {
  readonly kind='postgres' as const;
  private pool:SqlPool;
  private access:'reader'|'operator';
  private actor:string;
  constructor(pool:SqlPool,access:'reader'|'operator',actor='server') {
    if (!/^[a-zA-Z0-9_.:@-]{1,120}$/.test(actor)) throw new Error('A stable operator audit identity is required.');
    this.pool=pool; this.access=access; this.actor=actor;
  }
  private async operator(operation:Operation) {
    if (this.access!=='operator') throw new Error('Operator database access is required.');
    const identity=await productionOperation(operation);
    if(identity) this.actor=identity;
  }
  private async rows(client:SqlClient,all=false) {
    return (await client.query(`SELECT record, revoked_at FROM streamframe.sources${all?'':' WHERE revoked_at IS NULL'} ORDER BY id`)).rows;
  }
  async read(target?: {type:'movie'|'tv';id:number}) {
    if(this.access==='operator') await this.operator('inspect');
    const client=await this.pool.connect();
    try {
      const relation=this.access==='reader'?'streamframe.playback_records':'streamframe.sources';
      const conditions=this.access==='reader'?[]:['revoked_at IS NULL'];
      if(target) conditions.push('kind=$1 AND tmdb_id=$2');
      const rows=(await client.query(`SELECT record FROM ${relation}${conditions.length?' WHERE '+conditions.join(' AND '):''} ORDER BY record->>'id'`,
        target?[target.type==='movie'?'movie':'series',target.id]:[])).rows;
      return validateRegistry({version:1,sources:rows.map(row=>row.record)},'tmdb');
    } finally {client.release();}
  }
  private async audit(client:SqlClient,action:string,id:string|null,detail:object={}) {
    await client.query('INSERT INTO streamframe.audit_events(actor,action,source_id,detail) VALUES($1,$2,$3,$4::jsonb)',[this.actor,action,id,JSON.stringify(detail)]);
  }
  private async lock(client:SqlClient) {
    await client.query('SELECT pg_advisory_xact_lock(1937006962, 9)');
  }
  private async put(client:SqlClient,entry:RegistrySource) {
    rejectEmbeddedSecrets(entry);
    if (entry.target.namespace!=='tmdb') throw new Error('Demo sources remain outside the production registry.');
    const t=entry.target,kind=t.type==='movie'?'movie':'series';
    await client.query('INSERT INTO streamframe.content_refs(kind,tmdb_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[kind,t.tmdbId]);
    if (t.type==='episode') {
      await client.query('INSERT INTO streamframe.seasons(kind,tmdb_id,season) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[kind,t.tmdbId,t.season]);
      const existing=await client.query('SELECT tmdb_episode_id FROM streamframe.episodes WHERE kind=$1 AND tmdb_id=$2 AND season=$3 AND episode=$4',[kind,t.tmdbId,t.season,t.episode]);
      const episodeId=entry.supplierRelease?.tmdbEpisodeId;
      if (existing.rows[0]?.tmdb_episode_id && episodeId && Number(existing.rows[0].tmdb_episode_id)!==episodeId)
        throw new RegistryConflict('Episode identity conflicts with an existing mapping.');
      await client.query(`INSERT INTO streamframe.episodes(kind,tmdb_id,season,episode,tmdb_episode_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(kind,tmdb_id,season,episode) DO UPDATE SET tmdb_episode_id=coalesce(streamframe.episodes.tmdb_episode_id,excluded.tmdb_episode_id)`,[kind,t.tmdbId,t.season,t.episode,episodeId??null]);
    }
    const provider=entry.supplierRelease ? `supplier:${entry.supplierRelease.supplierId}` : entry.provenance?.provider ?? 'manual';
    await client.query('INSERT INTO streamframe.providers(id) VALUES($1) ON CONFLICT DO NOTHING',[provider]);
    await client.query(`INSERT INTO streamframe.sources(id,record) VALUES($1,$2::jsonb)
      ON CONFLICT(id) DO UPDATE SET record=excluded.record WHERE streamframe.sources.revoked_at IS NULL`,[entry.id,JSON.stringify(entry)]);
  }
  private async change(client:SqlClient,command:RegistryCommand,id:string,patch?:object,version?:string) {
    const rows=await this.rows(client,true);
    const tombstones=new Set(rows.filter(row=>row.revoked_at).map(row=>row.record.id));
    const current=validateRegistry({version:1,sources:rows.filter(row=>!row.revoked_at).map(row=>row.record)},'tmdb');
    // Exact package retries are harmless, including after an operator disabled a source.
    if (command==='approve-package' && Array.isArray(patch)) {
      const now=new Date().toISOString();
      const incoming=validateRegistry({version:1,sources:patch.map(entry=>({...entry,createdAt:now,updatedAt:now}))},'tmdb');
      if (incoming.some(entry=>!entry.supplierRelease)) throw new Error('Supplier release evidence is required.');
      patch=incoming.filter(entry=>{
        if(tombstones.has(entry.id)) throw new RegistryConflict('A source was revoked; retry cannot restore it.');
        const old=current.find(item=>item.id===entry.id);
        if(old && !sameEdition(old,entry)) throw new RegistryConflict('Package retry conflicts with an existing edition.');
        return !old;
      });
      if (!(patch as object[]).length) return current;
    }
    const next=applyRegistryMutation(current,command,id,patch,version);
    for (const entry of next) {
      if (tombstones.has(entry.id)) throw new RegistryConflict('A revoked source ID cannot be reused.');
      const before=current.find(item=>item.id===entry.id);
      if (before && canonical(before)===canonical(entry)) continue;
      await this.put(client,entry);
      await this.audit(client,command,entry.id,{before:before?digest(before):null,after:digest(entry)});
    }
    if (command==='remove') {
      await client.query("UPDATE streamframe.sources SET revoked_at=clock_timestamp(),revocation_reason='Removed by operator' WHERE id=$1 AND revoked_at IS NULL",[id]);
      await this.audit(client,'revoke',id,{reason:'Removed by operator'});
    }
    return next;
  }
  async mutate(command:RegistryCommand,id:string,patch?:object,version?:string) {
    const permissions:Record<RegistryCommand,Operation>={approve:'publish','approve-package':'publish',add:'edit',update:'edit',enable:'publish',disable:'disable',remove:'disable'};
    if(!Object.hasOwn(permissions,command)) throw new Error('Unknown registry command.');
    await this.operator(permissions[command]);
    if(command==='add' && patch && (('provenance' in patch && patch.provenance) || ('supplierRelease' in patch && patch.supplierRelease))) throw new Error('Use reviewed publication.');
    if(command==='update' && patch && 'enabled' in patch) await this.operator(patch.enabled?'publish':'disable');
    return transaction(this.pool,async client=>{await this.lock(client); return this.change(client,command,id,patch,version);});
  }
  async revoke(id:string,reason:string) {
    await this.operator('disable');
    if (!reason.trim() || reason.length>500) throw new Error('A revocation reason is required (up to 500 characters).');
    await transaction(this.pool,async client=>{
      await this.lock(client);
      const result=await client.query('UPDATE streamframe.sources SET revoked_at=clock_timestamp(),revocation_reason=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id',[id,reason]);
      if (!result.rows.length) throw new RegistryConflict('Source is missing or already revoked.');
      await this.audit(client,'revoke',id,{reason});
    });
  }
  async migrate(records:RegistrySource[],apply=false) {
    await this.operator('migrate');
    validateRegistry({version:1,sources:records},'tmdb');
    records.forEach(rejectEmbeddedSecrets);
    const selected=records.filter(approved).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const batch=digest(selected);
    return transaction(this.pool,async client=>{
      await this.lock(client);
      const rows=await this.rows(client,true);
      const existing=new Map(rows.map(row=>[row.record.id,row]));
      const conflicts=selected.filter(entry=>{
        const old=existing.get(entry.id);
        return old ? !!old.revoked_at || canonical(old.record)!==canonical(entry) : rows.some(row=>row.record.url===entry.url);
      }).map(entry=>entry.id);
      // Imported editions must not introduce duplicate URLs within the same batch.
      const urls=new Set<string>();
      for(const entry of selected) {if(urls.has(entry.url)) conflicts.push(entry.id); urls.add(entry.url);}
      const additions=selected.filter(entry=>!existing.has(entry.id));
      const report={batch,eligible:selected.length,skippedUnapproved:records.length-selected.length,unchanged:selected.length-additions.length,
        additions:additions.map(entry=>entry.id),conflicts:[...new Set(conflicts)],applied:false};
      if (!apply || conflicts.length) return report;
      const previous=await client.query('SELECT rolled_back_at FROM streamframe.migration_batches WHERE id=$1',[batch]);
      if (previous.rows[0]?.rolled_back_at) throw new RegistryConflict('This migration batch was rolled back; it cannot be replayed.');
      for (const entry of additions) {await this.put(client,entry); await this.audit(client,'migrate',entry.id,{batch,after:digest(entry)});}
      if (!previous.rows.length) await client.query('INSERT INTO streamframe.migration_batches(id,sources) VALUES($1,$2::jsonb)',[batch,JSON.stringify(additions.map(entry=>({id:entry.id,hash:digest(entry)})))]);
      return {...report,applied:true};
    });
  }
  async rollbackMigration(batch:string,apply=false) {
    await this.operator('migrate');
    if (!/^[a-f0-9]{64}$/.test(batch)) throw new Error('Invalid migration batch ID.');
    return transaction(this.pool,async client=>{
      await this.lock(client);
      const result=await client.query('SELECT sources,rolled_back_at FROM streamframe.migration_batches WHERE id=$1',[batch]);
      const record=result.rows[0];
      if (!record) throw new Error('Migration batch not found.');
      if (record.rolled_back_at) return {alreadyRolledBack:true,conflicts:[],revoked:0};
      const rows=await this.rows(client,true);
      const entries=record.sources as {id:string;hash:string}[];
      const conflicts=entries.filter(entry=>{const row=rows.find(row=>row.record.id===entry.id);return !row || !!row.revoked_at || digest(row.record)!==entry.hash;}).map(entry=>entry.id);
      if (!apply || conflicts.length) return {alreadyRolledBack:false,conflicts,revoked:0,wouldRevoke:entries.length};
      for (const entry of entries) {
        await client.query("UPDATE streamframe.sources SET revoked_at=clock_timestamp(),revocation_reason='Migration rollback' WHERE id=$1",[entry.id]);
        await this.audit(client,'migration-rollback',entry.id,{batch});
      }
      await client.query('UPDATE streamframe.migration_batches SET rolled_back_at=clock_timestamp() WHERE id=$1',[batch]);
      return {alreadyRolledBack:false,conflicts,revoked:entries.length};
    });
  }
  async checkpoint(id:string):Promise<ImportState> {
    await this.operator('inspect');
    const client=await this.pool.connect();
    try {
      const result=await client.query('SELECT state FROM streamframe.import_checkpoints WHERE id=$1',[id]);
      return result.rows.length?validateImportState(result.rows[0].state):emptyImportState();
    } finally {client.release();}
  }
  async withImportSession<T>(id:string,work:(session:ImportSession)=>Promise<T>):Promise<T> {
    await this.operator('sync');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid checkpoint ID.');
    const token=randomUUID();
    await transaction(this.pool,async client=>{
      await client.query('INSERT INTO streamframe.import_checkpoints(id,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[id,JSON.stringify(emptyImportState())]);
      const result=await client.query("UPDATE streamframe.import_checkpoints SET lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1 AND (lease_token IS NULL OR lease_until<clock_timestamp()) RETURNING id",[id,token]);
      if(!result.rows.length) throw new RegistryConflict('Another synchronization holds the checkpoint lease.');
    });
    const save=async (client:SqlClient,state:ImportState)=>{
      await this.operator('sync');
      validateImportState(state);
      const result=await client.query(`UPDATE streamframe.import_checkpoints SET state=$3::jsonb,revision=revision+1,
        updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
        WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id`,[id,token,JSON.stringify(state)]);
      if (!result.rows.length) throw new RegistryConflict('Import lease expired; stale worker cannot publish or checkpoint.');
    };
    try {
      return await work({store:this,read:()=>this.checkpoint(id),
        save:state=>transaction(this.pool,client=>save(client,state)),
        publish:(patch,state)=>transaction(this.pool,async client=>{
          await this.lock(client);
          await this.change(client,'approve','',patch);
          await save(client,state);
        })});
    } finally {
      await transaction(this.pool,async client=>{
        await client.query('UPDATE streamframe.import_checkpoints SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2',[id,token]);
      });
    }
  }
}
