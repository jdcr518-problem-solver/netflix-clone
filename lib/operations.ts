import 'server-only';
import {productionConfig} from './production-config.ts';
import {importSPKI,jwtVerify} from 'jose';

export type Operation = 'inspect'|'edit'|'publish'|'disable'|'migrate'|'schema'|'sync'|'validate-package';
const privileges:Record<string,readonly Operation[]>={
  auditor:['inspect'], editor:['inspect','edit'], publisher:['inspect','publish','validate-package','sync'],
  responder:['inspect','disable'], maintainer:['inspect','migrate','schema'],
  scheduler:['inspect','sync','validate-package'],
};

type Environment=Partial<NodeJS.ProcessEnv>;

// Run inside a private worker. Its immutable deployment configuration controls
// trust and permissions. The caller supplies only a short-lived access token.
export async function verifyOperation(operation:Operation,env:Environment,now=new Date()) {
  try {
    const job=env.STREAMFRAME_PRINCIPAL_KIND==='job';
    if(!job && env.STREAMFRAME_PRINCIPAL_KIND!=='operator') throw Error();
    const prefix=job?'STREAMFRAME_JOB_':'STREAMFRAME_SSO_';
    const issuer=env[prefix+'ISSUER'], audience=env[prefix+'AUDIENCE'];
    const key=env[prefix+'PUBLIC_KEY'], token=env.STREAMFRAME_ACCESS_TOKEN;
    if(!issuer || new URL(issuer).protocol!=='https:' || !audience || !key || !token || token.length>16384) throw Error();
    if(env.STREAMFRAME_JOB_AUDIENCE && env.STREAMFRAME_JOB_AUDIENCE===env.STREAMFRAME_SSO_AUDIENCE) throw Error();
    const authority=new URL(issuer);
    if(authority.username || authority.password || authority.search || authority.hash) throw Error();
    const {payload}=await jwtVerify(token,await importSPKI(key.replace(/\\n/g,'\n'),'RS256'),{
      issuer,audience,algorithms:['RS256'],typ:'at+jwt',requiredClaims:['sub','exp','iat'],
      maxTokenAge:600,currentDate:now,
    });
    const seconds=Math.floor(now.getTime()/1000);
    if(typeof payload.sub!=='string' || !/^[a-zA-Z0-9_.:@-]{1,100}$/.test(payload.sub) ||
        typeof payload.exp!=='number' || typeof payload.iat!=='number' ||
        !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) ||
        payload.exp<=payload.iat || payload.exp-payload.iat>600 || payload.aud!==audience) throw Error();
    let role:string;
    if(job) {
      if(payload.sub!==env.STREAMFRAME_JOB_SUBJECT) throw Error();
      role='scheduler';
    } else {
      if(!Array.isArray(payload.amr) || !payload.amr.includes('mfa') ||
         !Number.isSafeInteger(payload.auth_time) || Number(payload.auth_time)>payload.iat || seconds-Number(payload.auth_time)>900) throw Error();
      const assignments=JSON.parse(env.STREAMFRAME_SSO_ROLES??'{}');
      if(!Object.hasOwn(assignments,payload.sub)) throw Error();
      role=assignments[payload.sub];
      if(typeof role!=='string' || role==='scheduler') throw Error();
    }
    if(!Object.hasOwn(privileges,role) || !privileges[role].includes(operation)) throw Error();
    return (job?'job:':'operator:')+payload.sub;
  } catch {
    console.warn(JSON.stringify({event:'privileged_operation_denied',operation}));
    throw new Error('Privileged operation denied.');
  }
}

// The JSON tools retain their loopback-only development workflow. Production
// database CLIs must have NODE_ENV=production and run in a locked worker.
export async function productionOperation(operation:Operation) {
  if(process.env.NODE_ENV==='production') productionConfig(operation==='schema'?'migrator':process.env.STREAMFRAME_PRINCIPAL_KIND==='job'?'scheduler':'operator');
  const urls=[process.env.STREAMFRAME_DATABASE_WRITE_URL,process.env.STREAMFRAME_DATABASE_MIGRATION_URL];
  const remote=urls.some(value=>value && !['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));
  if(process.env.NODE_ENV==='production' || remote || process.env.STREAMFRAME_PRINCIPAL_KIND) return verifyOperation(operation,process.env);
}
