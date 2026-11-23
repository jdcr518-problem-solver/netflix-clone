import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {verifyOperation} from '../lib/operations.ts';
import {trustedCountry} from '../lib/package-rights.ts';
import {productionConfig} from '../lib/production-config.ts';
import {rightsSummary,packagePins,withScheduledLock} from '../lib/importer/scheduled.ts';
import {mediaMeter} from '../lib/operational-metrics.ts';
import type {RegistrySource} from '../lib/registry-schema.ts';
import {PostgresRegistry} from '../lib/database/registry.ts';
import type {SqlPool} from '../lib/database/connection.ts';

const now=Math.floor(Date.now()/1000);
const issuer='https://sso.example.invalid';
const keys=await generateKeyPair('RS256');
const env={STREAMFRAME_PRINCIPAL_KIND:'operator',STREAMFRAME_SSO_ISSUER:issuer,STREAMFRAME_SSO_AUDIENCE:'operator-cli',
  STREAMFRAME_SSO_PUBLIC_KEY:await exportSPKI(keys.publicKey),STREAMFRAME_SSO_ROLES:JSON.stringify({alice:'responder'})};
async function issue(claims:Record<string,unknown>={},key=keys.privateKey) {
  return new SignJWT({iss:issuer,aud:'operator-cli',sub:'alice',iat:now,exp:now+300,auth_time:now-20,amr:['mfa'],...claims})
    .setProtectedHeader({alg:'RS256',typ:'at+jwt'}).sign(key);
}
test('operator MFA and server-assigned role gate every requested capability',async()=>{
  const configured={...env,STREAMFRAME_ACCESS_TOKEN:await issue({role:'maintainer'})};
  assert.equal(await verifyOperation('disable',configured),'operator:alice');
  for(const op of ['publish','edit','migrate','schema','sync'] as const) await assert.rejects(verifyOperation(op,configured));
  for(const claims of [{amr:['pwd']},{auth_time:now-1000},{sub:'eve'},{iss:'https://elsewhere.invalid'},
    {aud:'scheduler'},{exp:now-1},{exp:now+3600},{iat:now+30},{nbf:now+30}])
    await assert.rejects(verifyOperation('disable',{...env,STREAMFRAME_ACCESS_TOKEN:await issue(claims)}));
  const other=await generateKeyPair('RS256');
  await assert.rejects(verifyOperation('disable',{...env,STREAMFRAME_ACCESS_TOKEN:await issue({},other.privateKey)}));
});
test('workload JWT can validate and sync with a separate audience and pinned subject',async()=>{
  const job={...env,STREAMFRAME_PRINCIPAL_KIND:'job',STREAMFRAME_JOB_ISSUER:issuer,STREAMFRAME_JOB_AUDIENCE:'scheduler',
    STREAMFRAME_JOB_SUBJECT:'worker',STREAMFRAME_JOB_PUBLIC_KEY:env.STREAMFRAME_SSO_PUBLIC_KEY,
    STREAMFRAME_ACCESS_TOKEN:await issue({aud:'scheduler',sub:'worker',amr:[]})};
  assert.equal(await verifyOperation('sync',job),'job:worker');
  assert.equal(await verifyOperation('validate-package',job),'job:worker');
  for(const op of ['disable','publish','schema','migrate','edit'] as const) await assert.rejects(verifyOperation(op,job));
  await assert.rejects(verifyOperation('sync',{...job,STREAMFRAME_ACCESS_TOKEN:await issue()}));
  await assert.rejects(verifyOperation('sync',{...job,STREAMFRAME_JOB_SUBJECT:'another'}));
});
test('production registry refuses unauthorized calls before opening an operator connection',async t=>{
  const variables:Record<string,string|undefined>=process.env;
  const previous=variables.NODE_ENV;
  t.after(()=>{if(previous===undefined) delete variables.NODE_ENV; else variables.NODE_ENV=previous;});
  variables.NODE_ENV='production';
  let reads=0;
  const db=new PostgresRegistry({connect:async()=>{reads++;throw Error();},end:async()=>{}},'operator','claimed-identity');
  for(const op of [()=>db.read(),()=>db.revoke('film','review'),()=>db.migrate([],true),
    ()=>db.mutate('enable','film'),()=>db.rollbackMigration('x'),()=>db.checkpoint('x'),()=>db.withImportSession('x',async()=>{})])
    await assert.rejects(op());
  assert.equal(reads,0);
});
test('production web requires independent keys and read-only credential configuration',()=>{
  const cfg={NODE_ENV:'production' as const,STREAMFRAME_REGISTRY_MODE:'postgres',STREAMFRAME_DATABASE_READ_URL:'postgresql://reader@db.invalid/catalog',
    TMDB_READ_ACCESS_TOKEN:'fixture',STREAMFRAME_DELIVERY_ORIGIN:'https://media.example.invalid',
    STREAMFRAME_DELIVERY_KEY:'a'.repeat(36),STREAMFRAME_GEO_PROXY_SECRET:'b'.repeat(36)};
  productionConfig('web',cfg);
  for(const change of [{STREAMFRAME_GEO_PROXY_SECRET:''},{STREAMFRAME_DELIVERY_KEY:cfg.STREAMFRAME_GEO_PROXY_SECRET},
    {STREAMFRAME_DATABASE_WRITE_URL:'unexpected'},{STREAMFRAME_DELIVERY_ORIGIN:'http://media.invalid'},{TMDB_READ_ACCESS_TOKEN:''}])
    assert.throws(()=>productionConfig('web',{...cfg,...change}));
  assert.throws(()=>productionConfig('gateway',cfg));
});
test('country proof, job overlap, expiry windows and media counters fail safely',async()=>{
  const secret='g'.repeat(32);
  for(const val of ['','XX','ZZ','pk','USA'])
    assert.equal(trustedCountry(new Headers({'x-streamframe-country':val,'x-streamframe-geo-key':secret}),secret),undefined);
  assert.equal(trustedCountry(new Headers({'x-streamframe-country':'PK'}),secret),undefined);
  const records=[-1,1,9].map(days=>({enabled:true,supplierRelease:{rights:{expiresAt:new Date(now*1000+days*86400000).toISOString()}}})) as RegistrySource[];
  assert.deepEqual(rightsSummary(records,now*1000),{expired:1,expiringWithinWeek:1});
  assert.deepEqual(packagePins(['a'.repeat(64),'a'.repeat(64)].join(',')),['a'.repeat(64)]);
  assert.throws(()=>packagePins('unreviewed.json'));
  let calls=0,releases=0,locked=false;
  const db:SqlPool={end:async()=>{},connect:async()=>({release:()=>{releases++;},query:async(sql)=>{
    if(sql.includes('try_advisory')) {const acquired=!locked;locked=true;return {rows:[{acquired}]};}
    locked=false;return {rows:[]};
  }})};
  await assert.rejects(withScheduledLock(db,async()=>{
    assert.equal(await withScheduledLock(db,async()=>{calls++;}),false);throw Error('interrupted');
  }));
  assert.equal(await withScheduledLock(db,async()=>{calls++;}),true);
  assert.equal(calls,1);assert.equal(releases,3);
  let time=0;const events:object[]=[];
  const count=mediaMeter(event=>events.push(event),()=>time);
  count(206,100);count(403);time=61000;count(503);
  assert.deepEqual(events,[{requests:3,bytes:100,failures:1,denied:1}]);
});
