import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {withScheduledLock} from '../lib/importer/scheduled.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { connectionOptions, transaction, type SqlPool } from '../lib/database/connection.ts';
import { migrateDatabase } from '../lib/database/migrations.ts';
import { PostgresRegistry } from '../lib/database/registry.ts';
import { registryMode } from '../lib/registry-store.ts';
import { validateRegistry, type RegistrySource } from '../lib/registry-schema.ts';
import { resolvePlayback, readRegistry } from '../lib/source-registry.ts';
import { emptyImportState, validateImportState } from '../lib/importer/state.ts';
import { synchronize } from '../lib/importer/sync.ts';
import type { ImportConfig } from '../lib/importer/policy.ts';
import { importSupplierPackage } from '../lib/importer/supplier-package.ts';

const date='2026-01-01T00:00:00.000Z';
const rights={licenseUrl:'https://example.invalid/license',licenseName:'Synthetic license',holder:'Fixture holder',
  attribution:'Synthetic QA only',attributionUrl:'https://example.invalid/credits',distribution:'free-on-demand' as const,
  territories:['PK'],startsAt:date,expiresAt:'2099-01-01T00:00:00.000Z',hostingEvidenceUrl:'https://example.invalid/private-host-evidence',hostEnforcement:'dates-and-territories' as const};
const source=(id:string,overrides:Partial<RegistrySource>={}):RegistrySource=>({id,target:{namespace:'tmdb',type:'movie',tmdbId:42},
  url:`https://example.invalid/${id}.mp4`,format:'mp4',enabled:true,rightsReference:'INTERNAL-EVIDENCE-DO-NOT-EXPOSE',
  createdAt:date,updatedAt:date,supplierRelease:{supplierId:'fixture',packageId:'fixture-package',title:'Synthetic Film',year:2020,
    durationSeconds:10800,rights,playbackEvidenceUrl:'https://example.invalid/private-review',audio:[{label:'Original',language:'en'}]},...overrides});
const pending=(id:string)=>source(id,{supplierRelease:undefined});
const episode=(id:string,number:number):RegistrySource=>{
  const value=source(id,{target:{namespace:'tmdb',type:'episode',tmdbId:42,season:1,episode:number}});
  value.supplierRelease={...value.supplierRelease!,tmdbEpisodeId:100+number,nextEpisodeId:null}; return value;
};

// PGlite runs real PostgreSQL SQL/constraints in WASM. A serialized connection
// wrapper emulates its single connection, not PostgreSQL network concurrency.
async function embedded() {
  const db=new PGlite();
  let queue=Promise.resolve();
  const pool:SqlPool={async connect() {
    const prior=queue; let release!:()=>void;
    queue=new Promise<void>(resolve=>{release=resolve;}); await prior;
    return {release,async query(sql,values) {
      if(values) return db.query<Record<string,any>>(sql,values);
      const result=await db.exec(sql); return result.at(-1) ?? {rows:[]};
    }};
  },end:()=>db.close()};
  return pool;
}
async function fixture(run:(store:PostgresRegistry,pool:SqlPool)=>Promise<void>) {
  const pool=await embedded();
  try {await migrateDatabase(pool,true); await run(new PostgresRegistry(pool,'operator','test-operator'),pool);}
  finally {await pool.end();}
}
async function query(pool:SqlPool,sql:string,values?:unknown[]) {
  const client=await pool.connect();try{return await client.query(sql,values);}finally{client.release();}
}

test('schema dry-run, transactional migrations, checksums and database constraints',async()=>{
  const pool=await embedded();
  try {
    assert.equal((await migrateDatabase(pool)).pending.length,2);
    assert.equal((await query(pool,"SELECT to_regclass('streamframe.sources') AS value")).rows[0].value,null);
    assert.equal((await migrateDatabase(pool,true)).applied.length,2);
    assert.deepEqual((await migrateDatabase(pool,true)).applied,[]);
    const store=new PostgresRegistry(pool,'operator','test');
    await store.migrate([source('one')],true);
    await assert.rejects(query(pool,'INSERT INTO streamframe.sources(id,record) SELECT id,record FROM streamframe.sources'),/duplicate/);
    await assert.rejects(query(pool,"UPDATE streamframe.sources SET record=jsonb_set(record,'{target,tmdbId}','-2')"),/foreign key|check constraint|immutable/);
    await assert.rejects(query(pool,"UPDATE streamframe.sources SET record=jsonb_set(record,'{enabled}','null')"),/not-null/);
    await query(pool,"UPDATE streamframe.schema_migrations SET checksum='changed'");
    await assert.rejects(migrateDatabase(pool,true),/modified/);
  } finally {await pool.end();}
});

test('database CRUD preserves pending state, stable IDs, timestamps, disabled and revoked sources',async()=>fixture(async(store,pool)=>{
  await store.mutate('add','',pending('draft'));
  assert.equal(resolvePlayback(await store.read(),'movie',42,'PK').availability,'unavailable');
  await assert.rejects(store.mutate('add','',pending('draft')),/duplicate/);
  const first=(await store.read())[0];
  await store.mutate('update','draft',{label:'Correct label'},first.updatedAt);
  await assert.rejects(store.mutate('update','draft',{label:'Stale'},first.updatedAt),/changed/);
  await assert.rejects(store.mutate('update','draft',{target:{namespace:'tmdb',type:'movie',tmdbId:9}}),/target cannot/);
  await store.mutate('disable','draft'); assert.equal((await store.read())[0].enabled,false);
  await store.mutate('enable','draft'); assert.equal((await store.read())[0].enabled,true);
  await store.revoke('draft','Rights withdrawn');
  assert.deepEqual(await store.read(),[]);
  await assert.rejects(store.mutate('add','',pending('draft')),/revoked/);
  assert.equal((await query(pool,'SELECT action FROM streamframe.audit_events ORDER BY id DESC LIMIT 1')).rows[0].action,'revoke');
  const reader=new PostgresRegistry(pool,'reader');
  await assert.rejects(reader.mutate('add','',pending('blocked')),/Operator/);
}));

test('atomic package publication, safe exact retries, episode identity and rollback on partial failure',async()=>fixture(async(store,pool)=>{
  await store.mutate('approve-package','',[source('film'),source('alternate'),episode('ep1',1),episode('ep2',2)]);
  assert.equal(resolvePlayback(await store.read(),'movie',42,'PK').sources.length,2);
  assert.equal(resolvePlayback(await store.read(),'tv',42,'PK').episodes.length,2);
  await store.mutate('disable','film');
  await store.mutate('approve-package','',[source('film'),source('alternate'),episode('ep1',1),episode('ep2',2)]);
  assert.equal((await store.read()).find(entry=>entry.id==='film')?.enabled,false);
  await assert.rejects(store.mutate('approve-package','',[source('film',{url:'https://example.invalid/changed.mp4'})]),/conflicts/);
  // First write succeeds inside the transaction, second fails its episode mapping.
  const conflict=episode('different-ep1',1); conflict.supplierRelease!.tmdbEpisodeId=900;
  await assert.rejects(store.mutate('approve-package','',[source('rollback-me'),conflict]),/Episode identity/);
  assert.equal((await store.read()).some(entry=>entry.id==='rollback-me'),false);
  assert.equal((await query(pool,"SELECT count(*)::int AS n FROM streamframe.audit_events WHERE source_id='rollback-me'")).rows[0].n,0);
  await store.mutate('remove','film');
  await assert.rejects(store.mutate('approve-package','',[source('film')]),/revoked/);
}));

test('safe JSON migration is dry by default, idempotent, conflict-reporting and reversible without overwrites',async()=>fixture(async(store,pool)=>{
  const input=[source('approved'),pending('pending'),source('disabled',{enabled:false})];
  const dry=await store.migrate(input); assert.equal(dry.skippedUnapproved,1); assert.equal(dry.additions.length,2);
  assert.deepEqual(await store.read(),[]);
  const applied=await store.migrate(input,true); assert.equal(applied.applied,true);
  const repeated=await store.migrate(input,true); assert.deepEqual(repeated.additions,[]);
  assert.deepEqual((await store.read()).find(entry=>entry.id==='approved'),input[0]);
  const collision=await store.migrate([source('new'),source('approved',{label:'Conflict'})],true);
  assert.deepEqual(collision.conflicts,['approved']); assert.equal((await store.read()).some(entry=>entry.id==='new'),false);
  await assert.rejects(store.migrate([source('duplicate'),source('duplicate')]),/duplicate/);
  await assert.rejects(store.migrate([source('secret',{rightsReference:'token=private-value'})]),/credential/);
  assert.equal((await store.rollbackMigration(applied.batch)).wouldRevoke,2);
  assert.equal((await store.rollbackMigration(applied.batch,true)).revoked,2);
  assert.deepEqual(await store.read(),[]);
  assert.equal((await store.migrate(input,true)).conflicts.length,2);
  assert.equal((await query(pool,'SELECT count(*)::int AS n FROM streamframe.sources')).rows[0].n,2);
}));

test('rollback refuses changed records and leaves other batch sources untouched',async()=>fixture(async store=>{
  const report=await store.migrate([source('one'),source('two')],true);
  await store.mutate('disable','one');
  const rollback=await store.rollbackMigration(report.batch,true);
  assert.deepEqual(rollback.conflicts,['one']); assert.equal((await store.read()).length,2);
}));

test('playback projection enforces license dates, territories, enablement and private information boundaries',async()=>fixture(async(store,pool)=>{
  const expired=source('expired');expired.supplierRelease!.rights={...rights,expiresAt:'2026-02-01T00:00:00.000Z'};
  const future=source('future');future.supplierRelease!.rights={...rights,startsAt:'2098-01-01T00:00:00.000Z'};
  const paid=source('paid');paid.supplierRelease!.rights={...rights,distribution:'paid-on-demand'};
  await store.migrate([source('valid'),expired,future,paid,source('disabled',{enabled:false})],true);
  await store.mutate('add','',pending('draft'));
  const reader=new PostgresRegistry(pool,'reader');
  const records=await reader.read();assert.equal(records.length,4);
  assert.equal(resolvePlayback(records,'movie',42).availability,'unavailable');
  assert.equal(resolvePlayback(records,'movie',42,'US').availability,'unavailable');
  const options=resolvePlayback(records,'movie',42,'PK');assert.deepEqual(options.sources.map(item=>item.id),['valid']);
  const publicJSON=JSON.stringify(options);
  for(const privateText of ['INTERNAL-EVIDENCE','private-host-evidence','private-review','supplierRelease','rightsReference','packageId']) assert.equal(publicJSON.includes(privateText),false);
  assert.equal(options.sources[0].credit?.text,rights.attribution);
  await store.revoke('valid','Expired permission');
  assert.equal(resolvePlayback(await reader.read(),'movie',42,'PK').availability,'unavailable');
}));

test('read role cannot modify sources or inspect checkpoints and audit is append only for operators',async()=>fixture(async(store,pool)=>{
  await store.migrate([source('approved')],true);
  await query(pool,await readFile(new URL('../db/roles.sql',import.meta.url),'utf8'));
  const client=await pool.connect();
  try {
    await client.query('SET ROLE streamframe_reader');
    assert.equal((await client.query('SELECT record FROM streamframe.playback_records')).rows.length,1);
    await assert.rejects(client.query('SELECT * FROM streamframe.sources'),/permission denied/);
    await assert.rejects(client.query('SELECT * FROM streamframe.import_checkpoints'),/permission denied/);
    await assert.rejects(client.query('UPDATE streamframe.sources SET revoked_at=now()'),/permission denied/);
    await client.query('RESET ROLE');await client.query('SET ROLE streamframe_operator');
    await assert.rejects(client.query("UPDATE streamframe.audit_events SET actor='forged'"),/permission denied/);
    await assert.rejects(client.query('DELETE FROM streamframe.sources'),/permission denied/);
  } finally {await client.query('RESET ROLE');client.release();}
}));

test('durable import checkpoints recover, exclude concurrent runners and fence expired workers atomically',async()=>fixture(async(store,pool)=>{
  assert.throws(()=>validateImportState({...emptyImportState(),cursors:{feed:{page:0,offset:-1}}}),/Malformed/);
  await store.withImportSession('test',async session=>{
    const state=await session.read();state.nextScope=3;await session.save(state);
    await assert.rejects(store.withImportSession('test',async()=>{}),/lease/);
  });
  assert.equal((await new PostgresRegistry(pool,'operator','restarted').checkpoint('test')).nextScope,3);
  const publisher={...pending('publisher'),provenance:{provider:'blender' as const,candidateId:'fixture',originalPage:'https://example.invalid/film',
    evidenceUrl:'https://example.invalid/evidence',owner:'Fixture',permittedUse:'QA only',attribution:'Credit',commercialRestrictions:'QA',verifiedAt:date,status:'approved' as const,
    releaseReview:{licenseName:'Fixture',licenseUrl:'https://example.invalid/license',hostingEvidenceUrl:'https://example.invalid/host',hostingNotes:'Private note',playbackNotes:'Private review',modificationNotice:'Unchanged',creditsVerified:true as const,playbackPassed:true as const}}};
  await store.withImportSession('test',async session=>{
    const state=await session.read();state.nextScope=4;await session.publish(publisher,state);
  });
  assert.equal((await store.checkpoint('test')).nextScope,4);
  assert.equal((await store.read()).length,1);
  await store.withImportSession('test',async session=>{
    await query(pool,"UPDATE streamframe.import_checkpoints SET lease_until=clock_timestamp()-interval '1 second' WHERE id='test'");
    await assert.rejects(session.publish({...publisher,id:'stale',url:'https://example.invalid/stale.mp4'},emptyImportState()),/lease expired/);
    await assert.rejects(session.save(emptyImportState()),/lease expired/);
  });
  assert.equal((await store.read()).some(item=>item.id==='stale'),false);
  assert.equal((await store.checkpoint('test')).nextScope,4);
  await query(pool,"UPDATE streamframe.import_checkpoints SET state='{}'::jsonb WHERE id='test'");
  await assert.rejects(store.checkpoint('test'),/Malformed/);
}));

test('supplier workflow publishes via database store with idempotent reviewed package retry',async()=>fixture(async store=>{
  const manifest={version:1,supplierId:'fixture',packageId:'test',rights,titles:[{type:'movie',tmdbId:42,title:'Synthetic Film',year:2020,durationSeconds:120,
    sources:[{id:'one',url:'https://example.invalid/one.mp4',format:'mp4',review:{evidenceUrl:'https://example.invalid/review',playbackPassed:true,seekPassed:true,resumePassed:true,creditsVerified:true,hostControlsVerified:true}}]}]};
  const dependencies={origins:new Set(['https://example.invalid']),catalog:{title:async()=>({id:42,names:['Synthetic Film'],year:2020,durationMinutes:2}),season:async()=>({episodes:[],hasNextSeason:false})},
    storage:{verifyVideo:async()=>{},readSubtitle:async()=>''}};
  const run=(publish:boolean)=>importSupplierPackage(store,{readPackage:async()=>manifest},dependencies,publish,AbortSignal.timeout(10000));
  await run(false);assert.deepEqual(await store.read(),[]);
  await run(true);await run(true);assert.equal((await store.read()).length,1);
}));

test('automatic publisher workflow uses durable DB checkpoints and does not republish disabled editions',async()=>fixture(async store=>{
  const edition={candidateId:'fixture',url:'https://download.blender.org/demo/movies/fixture.mp4',format:'mp4' as const,tmdbId:42,title:'Fixture Film',year:2020,director:'Fixture Director',durationSeconds:120,
    creditsVerified:true as const,browserPlaybackEvidenceUrl:'https://example.invalid/review',modificationNotice:'Fixture'};
  const config:ImportConfig={version:1,minimumIntervalMinutes:60,pageSize:1,discovery:[{provider:'blender',collection:'blender-open-movies'}],policies:[{id:'fixture',action:'preauthorize',provider:'blender',collection:'blender-open-movies',publisher:'Fixture',evidenceUrl:'https://example.invalid/evidence',hostingEvidenceUrl:'https://example.invalid/host',licenseName:'Fixture',licenseUrl:'https://example.invalid/license',hostingNotes:'Fixture',permittedUse:'QA only',restrictions:'QA only',attribution:'QA',distribution:'public-browser-direct',playbackOrigin:'https://example.invalid',validUntil:'2099-01-01T00:00:00.000Z',editions:[edition]}]};
  const dependencies={discover:async()=>({ids:['fixture'],hasMore:false}),get:async()=>({provider:'blender' as const,id:'fixture',title:'Fixture Film',year:2020,owner:'Fixture',director:'Fixture Director',collections:['blender-open-movies'],description:'QA',originalPage:'https://example.invalid/film',files:[{name:'fixture.mp4',url:edition.url,format:'mp4' as const}],subtitles:[],subtitleNotes:[],playbackNote:''}),
    matches:async()=>[{id:42,title:'Fixture Film',release_date:'2020-01-01',director:'Fixture Director',runtime:2}],check:async()=>({duration:120,summary:'Synthetic check'})};
  const run=(mode:'now'|'due')=>store.withImportSession('sync',session=>synchronize('unused',config,dependencies,mode,undefined,session));
  assert.equal((await run('now')).state.history[0].published,1);
  assert.equal((await run('due')).skipped,true);
  await store.mutate('disable',(await store.read())[0].id);
  await run('now');assert.equal((await store.read()).length,1);assert.equal((await store.read())[0].enabled,false);
}));

test('explicit production selection and TLS validation never fall back to JSON',async t=>{
  assert.equal(registryMode({NODE_ENV:'development'}),'json');
  assert.throws(()=>registryMode({NODE_ENV:'production'}),/requires/);
  assert.throws(()=>registryMode({NODE_ENV:'production',STREAMFRAME_REGISTRY_MODE:'json'}),/requires/);
  assert.throws(()=>registryMode({STREAMFRAME_REGISTRY_MODE:'unknown'}),/Unsupported/);
  assert.throws(()=>connectionOptions('reader',{}),/Missing/);
  const env={STREAMFRAME_DATABASE_READ_URL:'postgresql://fixture@localhost/fixture',STREAMFRAME_DATABASE_LOCAL_INSECURE:'1'};
  assert.equal(connectionOptions('reader',env).ssl,false);
  assert.throws(()=>connectionOptions('reader',{...env,NODE_ENV:'production'}),/limited/);
  assert.throws(()=>connectionOptions('reader',{...env,STREAMFRAME_DATABASE_READ_URL:'postgresql://fixture@db.example.invalid/fixture'}),/limited/);
  assert.throws(()=>connectionOptions('reader',{...env,STREAMFRAME_DATABASE_READ_URL:env.STREAMFRAME_DATABASE_READ_URL+'?sslmode=no-verify'}),/TLS/);
  const before=process.env.STREAMFRAME_REGISTRY_MODE;process.env.STREAMFRAME_REGISTRY_MODE='invalid';
  t.after(()=>{if(before===undefined) delete process.env.STREAMFRAME_REGISTRY_MODE;else process.env.STREAMFRAME_REGISTRY_MODE=before;});
  assert.deepEqual(await readRegistry(),[]);
});

test('native PostgreSQL driver and concurrent transaction integration (optional loopback database)',{skip:!process.env.STREAMFRAME_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.STREAMFRAME_TEST_DATABASE_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Tests only run against a disposable local server.');
  assert.match(url.pathname,/^\/streamframe_test_[a-z0-9_]+$/,'Dedicated test database required.');
  const pool=new pg.Pool({connectionString:url.toString(),max:3});
  try {
    const existing=await pool.query("SELECT to_regclass('streamframe.sources') AS relation");
    assert.equal(existing.rows[0].relation,null,'Use a fresh disposable database; tests never clear existing data.');
    await withScheduledLock(pool,async()=>{
      assert.equal(await withScheduledLock(pool,async()=>assert.fail('overlap')),false);
    });
    assert.equal(await withScheduledLock(pool,async()=>{}),true);
    await installLegacy(pool);
    await migrateDatabase(pool,true);
    const store=new PostgresRegistry(pool,'operator','native-test');
    await mediaCompatibility(store,pool);
    const results=await Promise.allSettled([store.mutate('add','',pending('same')),store.mutate('add','',pending('same'))]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await store.read()).length,acceptedUrls.length+1);
    await assert.rejects(transaction(pool,async client=>{await client.query("INSERT INTO streamframe.providers(id) VALUES('rollback')");throw new Error('rollback');}));
    assert.equal((await pool.query("SELECT * FROM streamframe.providers WHERE id='rollback'")).rowCount,0);
  } finally {await pool.end();}
});

async function installLegacy(pool:SqlPool) {
  const sql=(await readFile(new URL('../db/migrations/001_registry.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  await query(pool,sql);
  await query(pool,'CREATE TABLE streamframe.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  await query(pool,'INSERT INTO streamframe.schema_migrations(name,checksum) VALUES($1,$2)',['001_registry.sql',createHash('sha256').update(sql).digest('hex')]);
}
const acceptedUrls:[string,'mp4'|'hls'][]=[
  ['https://example.invalid/Film.MP4','mp4'],['https://example.invalid/Movie.Mp4','mp4'],
  ['https://example.invalid/Playlist.M3U8','hls'],['https://example.invalid/Stream.m3U8','hls'],
  ['https://example.invalid/lower.mp4','mp4'],['https://example.invalid/Stream.m3u8','hls'],
  ['https://example.invalid/.mp4','mp4'],['https://example.invalid:8443/a@b.MP4','mp4']
];
async function mediaCompatibility(store:PostgresRegistry,pool:SqlPool) {
  for(const [index,[url,format]] of acceptedUrls.entries()) {
    const entry=source(`url-${index}`,{url,format});
    validateRegistry({version:1,sources:[entry]},'tmdb');
    assert.equal((await store.migrate([entry],true)).applied,true);
    assert.equal((await store.read()).find(row=>row.id===entry.id)?.url,url);
  }
  for(const [index,url] of ['http://example.invalid/a.mp4','HTTPS://example.invalid/a.mp4',
    'https://user:pass@example.invalid/a.mp4','https://example.invalid/a/../a.mp4',
    'https://example.invalid/a/./a.mp4','https://example.invalid/a%20b.mp4',
    'https://example.invalid/a.mp4?token=x','https://example.invalid/a.mp4#x',
    'https://example.invalid/a\tb.mp4','https://example.invalid/a\\b.mp4',
    'https://example.invalid/mismatch.m3u8','https://example.invalid/'+ 'a'.repeat(2048)+'.mp4'].entries()) {
    const entry=source(`bad-url-${index}`,{url});
    assert.throws(()=>validateRegistry({version:1,sources:[entry]},'tmdb'));
    await assert.rejects(query(pool,'INSERT INTO streamframe.sources(id,record) VALUES($1,$2::jsonb)',[entry.id,JSON.stringify(entry)]),/check constraint/);
  }
}
test('media URL constraint accepts application-valid casing and rejects unsafe SQL inserts',async()=>fixture(mediaCompatibility));
test('002 upgrades existing rows without changing 001 and is repeatable',async()=>{
  const pool=await embedded();
  try {
    await installLegacy(pool);
    const store=new PostgresRegistry(pool,'operator','upgrade-test');
    const old=source('existing');await store.migrate([old],true);
    assert.deepEqual((await migrateDatabase(pool)).pending,['002_media_urls.sql']);
    assert.deepEqual((await migrateDatabase(pool,true)).applied,['002_media_urls.sql']);
    assert.deepEqual((await store.read())[0],old);
    await mediaCompatibility(store,pool);
    assert.deepEqual((await migrateDatabase(pool,true)).applied,[]);
  } finally {await pool.end();}
});
test('invalid legacy rows roll back constraint upgrade and migration ledger atomically',async()=>{
  const pool=await embedded();
  try {
    await installLegacy(pool);
    const store=new PostgresRegistry(pool,'operator','upgrade-test');await store.migrate([source('legacy')],true);
    await query(pool,`UPDATE streamframe.sources SET record=jsonb_set(record,'{url}','"https://example.invalid/a/../bad.mp4"')`);
    await assert.rejects(migrateDatabase(pool,true),/check constraint/);
    assert.deepEqual((await migrateDatabase(pool)).pending,['002_media_urls.sql']);
    assert.equal((await query(pool,'SELECT count(*)::int AS n FROM streamframe.sources')).rows[0].n,1);
  } finally {await pool.end();}
});

test('signed worker permissions bind database changes to the authenticated audit actor',async()=>{
  await fixture(async(store,pool)=>{
    await store.mutate('approve-package','',[source('incident')]);
    const keys=await generateKeyPair('RS256');
    const issuer='https://identity.example.invalid';
    const token=await new SignJWT({amr:['mfa'],auth_time:Math.floor(Date.now()/1000)})
      .setProtectedHeader({alg:'RS256',typ:'at+jwt'}).setIssuer(issuer).setAudience('ops').setSubject('oncall')
      .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const vars:Record<string,string|undefined>=process.env;
    const config={NODE_ENV:'production',STREAMFRAME_REGISTRY_MODE:'postgres',STREAMFRAME_DATABASE_WRITE_URL:'postgresql://worker@database.invalid/catalog',
      STREAMFRAME_PRINCIPAL_KIND:'operator',STREAMFRAME_ACCESS_TOKEN:token,STREAMFRAME_SSO_ISSUER:issuer,STREAMFRAME_SSO_AUDIENCE:'ops',
      STREAMFRAME_SSO_PUBLIC_KEY:await exportSPKI(keys.publicKey),STREAMFRAME_SSO_ROLES:JSON.stringify({oncall:'responder'})};
    const previous=Object.keys(config).map(key=>[key,vars[key]] as const);
    Object.assign(vars,config);
    try {
      await store.mutate('disable','incident');
      await assert.rejects(store.mutate('enable','incident'),/denied/);
      const rows=await query(pool,"SELECT actor,action FROM streamframe.audit_events WHERE source_id='incident' AND action='disable'");
      assert.deepEqual(rows.rows,[{actor:'operator:oncall',action:'disable'}]);
      assert.equal((await store.read())[0].enabled,false);
    } finally {for(const [key,value] of previous) {if(value===undefined) delete vars[key];else vars[key]=value;}}
  });
});
