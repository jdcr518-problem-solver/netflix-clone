import 'server-only';
import {catalogToken} from './tmdb-credential.ts';
import {connectionOptions} from './database/connection.ts';

export type RuntimeRole='web'|'gateway'|'scheduler'|'operator'|'migrator';
type Env=Partial<NodeJS.ProcessEnv>;
export function httpsOrigin(value:string|undefined) {
  if(!value) throw new Error('Missing HTTPS origin.');
  const url=new URL(value);
  if(url.protocol!=='https:' || url.origin!==value) throw new Error('Expected an exact HTTPS origin.');
  return value;
}
export function productionConfig(role:RuntimeRole,env:Env=process.env) {
  if(env.NODE_ENV!=='production' || env.STREAMFRAME_REGISTRY_MODE!=='postgres') throw new Error('Production PostgreSQL configuration required.');
  const required=(name:string)=>{if(!env[name]?.trim()) throw new Error('Missing '+name);};
  const reject=(names:string[])=>{for(const name of names) if(env[name]) throw new Error('Unexpected credential for '+role+': '+name);};
  const write='STREAMFRAME_DATABASE_WRITE_URL',migration='STREAMFRAME_DATABASE_MIGRATION_URL';
  const token='STREAMFRAME_ACCESS_TOKEN',storageKey='STREAMFRAME_STORAGE_SECRET_ACCESS_KEY';
  connectionOptions(role==='migrator'?'migrator':role==='operator'||role==='scheduler'?'operator':'reader',env);
  if(role==='web' || role==='gateway') {
    reject([write,migration,token]);
    httpsOrigin(env.STREAMFRAME_DELIVERY_ORIGIN);
    const secrets=[env.STREAMFRAME_DELIVERY_KEY,env.STREAMFRAME_GEO_PROXY_SECRET];
    if(secrets.some(v=>!v || Buffer.byteLength(v)<32) || secrets[0]===secrets[1]) throw new Error('Independent delivery and geo keys required.');
    if(role==='web') {catalogToken(env);reject([storageKey,'AWS_SECRET_ACCESS_KEY']);}
    else {
      httpsOrigin(env.STREAMFRAME_PLAYER_ORIGIN);
      httpsOrigin(env.STREAMFRAME_STORAGE_ENDPOINT);
      for(const name of ['REGION','BUCKET','ACCESS_KEY_ID','SECRET_ACCESS_KEY']) required('STREAMFRAME_STORAGE_'+name);
    }
  } else {
    reject([role==='migrator'?write:migration,'STREAMFRAME_DELIVERY_KEY','STREAMFRAME_GEO_PROXY_SECRET',storageKey]);
    required(token);
    const job=role==='scheduler';
    if(env.STREAMFRAME_PRINCIPAL_KIND!==(job?'job':'operator')) throw new Error('Wrong worker identity kind.');
    const prefix=job?'STREAMFRAME_JOB_':'STREAMFRAME_SSO_';
    for(const name of ['ISSUER','AUDIENCE','PUBLIC_KEY',job?'SUBJECT':'ROLES']) required(prefix+name);
    if(job) {
      catalogToken(env);
      if(!/^[a-f0-9]{64}$/.test(env.STREAMFRAME_POLICY_SHA256??'')) throw new Error('Missing reviewed supplier policy digest.');
    }
  }
}
