import {productionConfig,httpsOrigin,type RuntimeRole} from '../lib/production-config.ts';
import {closeDatabasePools,databasePool} from '../lib/database/connection.ts';
import {verifyOperation} from '../lib/operations.ts';
import {createProductionGateway} from '../lib/delivery/production-gateway.ts';
import {readFile} from 'node:fs/promises';
import {reviewedProductionPolicy} from '../lib/importer/policy.ts';

const [mode,roleArg,stage,extra]=process.argv.slice(2);
const roles:RuntimeRole[]=['web','gateway','operator','scheduler','migrator'];
const role=roleArg as RuntimeRole;
async function main() {
  if(!roles.includes(role) || extra) throw Error();
  if(mode==='template') {
    if(stage!=='staging' && stage!=='production') throw Error();
    const host=stage==='staging'?'staging.example.invalid':'example.invalid';
    const vars:Record<string,string>={NODE_ENV:'production',STREAMFRAME_REGISTRY_MODE:'postgres'};
    const empty=(...names:string[])=>{for(const name of names) vars[name]='';};
    const interactive=role==='operator'||role==='migrator';
    const worker=interactive||role==='scheduler';
    empty('STREAMFRAME_DATABASE_'+(role==='migrator'?'MIGRATION':worker?'WRITE':'READ')+'_URL','STREAMFRAME_DATABASE_CA');
    if(role==='web'||role==='scheduler'||role==='operator') empty('TMDB_READ_ACCESS_TOKEN','STREAMFRAME_TMDB_APPROVED_SHA256');
    if(!worker) {
      vars.STREAMFRAME_DELIVERY_ORIGIN='https://media.'+host;
      vars.STREAMFRAME_PLAYER_ORIGIN='https://watch.'+host;
      empty('STREAMFRAME_DELIVERY_KEY','STREAMFRAME_GEO_PROXY_SECRET');
    }
    if(role==='gateway') empty(...['REGION','ENDPOINT','BUCKET','ACCESS_KEY_ID','SECRET_ACCESS_KEY','SESSION_TOKEN'].map(x=>'STREAMFRAME_STORAGE_'+x));
    if(worker) {
      vars.STREAMFRAME_PRINCIPAL_KIND=interactive?'operator':'job';
      empty('STREAMFRAME_ACCESS_TOKEN');
      for(const key of ['ISSUER','AUDIENCE','PUBLIC_KEY',interactive?'ROLES':'SUBJECT']) empty((interactive?'STREAMFRAME_SSO_':'STREAMFRAME_JOB_')+key);
      if(role!=='migrator') empty('STREAMFRAME_POLICY_SHA256','STREAMFRAME_SUPPLIER_MEDIA_ORIGINS');
      if(role==='scheduler') empty('STREAMFRAME_PACKAGE_DIGESTS');
    }
    console.log(Object.entries(vars).map(([key,value])=>key+'='+value).join('\n'));
    return;
  }
  if(stage || !['config','probe'].includes(mode)) throw Error();
  productionConfig(role);
  if(role==='operator'||role==='scheduler'||role==='migrator')
    await verifyOperation(role==='migrator'?'schema':role==='scheduler'?'sync':'inspect',process.env);
  if(role==='scheduler') reviewedProductionPolicy(await readFile('data/import-policy.local.json'),process.env.STREAMFRAME_POLICY_SHA256);
  if(mode==='probe') {
    const db=await databasePool(role==='migrator'?'migrator':role==='scheduler'||role==='operator'?'operator':'reader').connect();
    try {
      await db.query('SELECT 1');
      if(role==='scheduler') {
        const result=await db.query("SELECT state FROM streamframe.import_checkpoints WHERE id='publisher-sync'");
        const latest=result.rows[0]?.state?.history?.[0];
        if(latest?.status!=='complete' || latest.playbackFailed!==0 || !(Date.parse(latest.endedAt)>Date.now()-86400000)) throw Error();
      }
    } finally {db.release();}
    if(role==='gateway') {
      const gateway=createProductionGateway();
      try {
        const response=await gateway.handle(new Request(httpsOrigin(process.env.STREAMFRAME_DELIVERY_ORIGIN)+'/v1/missing'));
        if(response.status!==403) throw Error();
      } finally {gateway.close();}
    }
    if(role==='web') {
      const origin=httpsOrigin(process.env.STREAMFRAME_PLAYER_ORIGIN);
      for(const [path,status] of [['/player-demo',200],['/api/admin/sources',404],['/api/playback?type=movie&id=1',200]] as const) {
        const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
        if(response.status!==status) throw Error();
        if(path.startsWith('/api/playback') && (!response.headers.get('cache-control')?.includes('no-store') ||
          !['available','unavailable'].includes((await response.json()).availability))) throw Error();
        else await response.body?.cancel().catch(()=>{});
      }
    }
  }
  console.log(role+' '+mode+' passed.');
}
main().catch(()=>{console.error('Readiness check failed. Check arguments, private configuration and runtime dependencies.');process.exitCode=1;}).finally(closeDatabasePools);
