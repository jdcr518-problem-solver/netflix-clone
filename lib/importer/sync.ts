import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FilmCandidate } from '../providers/blender';
import type { FilmMatch } from '../providers/matching';
import type { RegistrySource } from '../registry-schema';
import { mutateRegistry, readRegistryFile, RegistryConflict } from '../registry-file.ts';
import { evaluatePolicy, identity, parseConfig } from './policy.ts';
import type { Edition, ImportConfig, Policy } from './policy.ts';
import type { CheckResult } from './media';

type Scope = ImportConfig['discovery'][number];
type Status = 'pending'|'rejected'|'published'|'already-registered'|'playback-failed'|'import-error';
interface CandidateStatus {
  key:string; title:string; page:string; status:Status; reason:string; checkedAt:string;
  year?:number; owner?:string; license?:string; formats?:string[]; subtitleNotes?:string[];
}
interface Cursor { page:number; offset:number }
export interface Run { startedAt:string; endedAt?:string; status:'running'|'complete'|'partial'|'interrupted'; discovered:number;
  newTitles:number; published:number; pending:number; rejected:number; playbackFailed:number; errors:number; messages:string[] }
export interface ImportState { version:1; configHash:string; nextScope:number; cursors:Record<string,Cursor>;
  candidates:CandidateStatus[]; history:Run[] }

interface Dependencies {
  discover(scope:Scope,page:number,pageSize:number,signal:AbortSignal):Promise<{ids:string[];hasMore:boolean}>;
  get(provider:Scope['provider'],id:string,signal:AbortSignal):Promise<FilmCandidate|undefined>;
  matches(candidate:FilmCandidate,signal:AbortSignal):Promise<FilmMatch[]>;
  check(edition:Edition,origin:string,signal:AbortSignal,rule:Policy):Promise<CheckResult>;
}

const time = () => new Date().toISOString();
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function formatError(value:unknown) {
  // Never serialize raw upstream messages, URLs, tokens or request headers.
  return value instanceof RegistryConflict ? 'Registry changed or is locked.' : 'The operation failed or timed out.';
}
const empty = ():ImportState => ({version:1,configHash:'',nextScope:0,cursors:{},candidates:[],history:[]});

export async function readImportState(path:string):Promise<ImportState> {
  try {
    const state=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
    if (state?.version!==1 || !Array.isArray(state.history) || !Array.isArray(state.candidates) ||
      !state.cursors || !Number.isSafeInteger(state.nextScope) || state.nextScope<0) throw new Error('Malformed import checkpoint.');
    const seen=new Set<string>();
    state.candidates=state.candidates.flatMap((item:CandidateStatus)=>{
      const parts=item.key.split(':');
      const key=`${parts[0]}:${parts.at(-1)}`;
      if(seen.has(key)) return [];
      seen.add(key);
      return [{...item,key}];
    });
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return empty();
    throw error;
  }
}

async function save(path:string,state:ImportState) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tmp,'wx',0o600);
  try {
    try { await handle.writeFile(JSON.stringify(state,null,2)+'\n','utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp,path);
  } finally { await unlink(tmp).catch(()=>{}); }
}

export function uniqueMatch(candidate:FilmCandidate,edition:Edition,matches:FilmMatch[]) {
  const exact = matches.filter(movie=>movie.release_date?.slice(0,4)===String(edition.year)
    && [movie.title,movie.original_title].some(title=>title && identity(title)===identity(candidate.title))
    && movie.director?.split(',').some(name=>identity(name)===identity(edition.director))
    && Number.isFinite(movie.runtime) && Math.abs(movie.runtime!*60-edition.durationSeconds)<=120);
  return exact.length===1 && exact[0].id===edition.tmdbId ? exact[0] : undefined;
}

async function retry<T>(fn:()=>Promise<T>,signal:AbortSignal) {
  try { return await fn(); }
  catch (error) {
    const status=(error as {status?:number})?.status;
    if (signal.aborted || (typeof status==='number' && status>=400 && status<500 && status!==408)
      || (error instanceof Error && error.message.startsWith('Catalog is busy'))) throw error;
    await delay(650,undefined,{signal});
    return fn();
  }
}

function approvedSource(candidate:FilmCandidate,rule:Policy,edition:Edition,checked:CheckResult): Omit<RegistrySource,'createdAt'|'updatedAt'> {
  const id=`film-${candidate.provider}-${createHash('sha256').update(edition.url).digest('hex').slice(0,20)}`;
  return {id,target:{namespace:'tmdb',type:'movie',tmdbId:edition.tmdbId},url:edition.url,format:edition.format,enabled:true,
    label:`${candidate.provider==='blender'?'Blender Open Movie':'Internet Archive'} · ${edition.format.toUpperCase()}`,
    subtitles:edition.subtitles?.map(({id,label,language,url})=>({id,label,language,url})),
    rightsReference:rule.evidenceUrl!,provenance:{provider:candidate.provider,candidateId:candidate.id,originalPage:candidate.originalPage,
      evidenceUrl:rule.evidenceUrl!,owner:candidate.owner,permittedUse:rule.permittedUse!,attribution:rule.attribution!,
      commercialRestrictions:rule.restrictions!,verifiedAt:time(),status:'approved',
      releaseReview:{licenseName:rule.licenseName!,licenseUrl:rule.licenseUrl!,hostingEvidenceUrl:rule.hostingEvidenceUrl!,
        hostingNotes:rule.hostingNotes!,playbackNotes:checked.summary,modificationNotice:edition.modificationNotice,
        creditsVerified:true,playbackPassed:true,automation:{policyId:rule.id,policyHash:hash(rule),validUntil:rule.validUntil!,
          browserEvidenceUrl:edition.browserPlaybackEvidenceUrl,durationSeconds:checked.duration,
          ...(edition.ownedMasterUrl ? {publisherMasterUrl:edition.ownedMasterUrl,mediaSha256:edition.mediaSha256} : {})}}}};
}

export async function synchronize(directory:string,configuration:unknown,dependencies:Dependencies,mode:'due'|'now'='due',stop?:AbortSignal) {
  if (process.env.NODE_ENV==='production') throw new Error('Local synchronization is disabled in production.');
  const config=parseConfig(configuration);
  const statePath=join(directory,'import-state.local.json');
  const registryPath=join(directory,'sources.local.json');
  const lockPath=statePath+'.lock';
  const lock=await open(lockPath,'wx',0o600).catch(error=>{
    if (error.code==='EEXIST') throw new RegistryConflict('Another synchronization is running, or its lock needs recovery.');
    throw error;
  });
  try {
    await lock.writeFile(String(process.pid),'utf8');
    await lock.sync();
    const state=await readImportState(statePath);
    const previous=state.history[0];
    if (mode==='due' && previous && previous.status!=='running' &&
      Date.now()-Date.parse(previous.startedAt)<config.minimumIntervalMinutes*60000) return {state,skipped:true};
    if (previous?.status==='running') {
      previous.status='interrupted';
      previous.endedAt=time();
    }
    const revision=hash(config);
    if (revision!==state.configHash) {
      state.configHash=revision; state.cursors={}; state.nextScope=0;
      state.candidates=[];
    }
    const run:Run={startedAt:time(),status:'running',discovered:0,newTitles:0,published:0,pending:0,rejected:0,playbackFailed:0,errors:0,messages:[]};
    state.history=[run,...state.history].slice(0,20);
    await save(statePath,state);
    const deadline=AbortSignal.timeout(40000);
    const signal=stop ? AbortSignal.any([deadline,stop]):deadline;
    const record=(status:CandidateStatus)=> {
      state.candidates=[status,...state.candidates.filter(entry=>entry.key!==status.key)].slice(0,350);
    };

    // One page per configured feed at most. Rotate the starting feed after each run.
    const start=state.nextScope%config.discovery.length;
    for(let i=0;i<config.discovery.length && !signal.aborted;i++){
      const scope=config.discovery[(start+i)%config.discovery.length];
      const scopeKey=`${scope.provider}:${scope.collection}`;
      const cursor=state.cursors[scopeKey] ?? {page:1,offset:0};
      try {
        const page=await retry(()=>dependencies.discover(scope,cursor.page,config.pageSize,signal),signal);
        const ids=[...new Set(page.ids)];
        for(let index=cursor.offset; index<ids.length; index++){
          signal.throwIfAborted();
          const id=ids[index];
          const key=`${scope.provider}:${id}`;
          const cached=state.candidates.find(entry=>entry.key===key);
          run.discovered++;
          if (!cached) run.newTitles++;
          if (!cached || cached.status==='import-error' || Date.now()-Date.parse(cached.checkedAt)>86400000) {
            let details:FilmCandidate|undefined;
            const result=(status:Status,reason:string)=>{
              record({key,title:details?.title || id,page:details?.originalPage ?? '',status,reason,checkedAt:time(),
                year:details?.year,owner:details?.owner,license:details?.licenseClaim,
                formats:details?.files.map(file=>file.format),subtitleNotes:details?.subtitleNotes});
            };
            try {
              await delay(250,undefined,{signal});
              details=await retry(()=>dependencies.get(scope.provider,id,signal),signal);
              if (!details) {run.rejected++;result('rejected','The provider record is unavailable or not a movie.');}
              else {
                const decision=evaluatePolicy(config,details);
                if (decision.status!=='eligible') {
                  if(decision.status==='pending') run.pending++; else run.rejected++;
                  result(decision.status,decision.reason);
                } else {
                  const registered=await readRegistryFile(registryPath);
                  if (decision.editions.some(({edition})=>registered.some(entry=>entry.url===edition.url))) {
                    result('already-registered','This edition already exists. Sync leaves its enablement and progress ID intact.');
                  } else {
                    const matches=await retry(()=>dependencies.matches(details!,signal),signal);
                    const matchable=decision.editions.filter(({edition})=>uniqueMatch(details!,edition,matches));
                    if (!matchable.length) {run.pending++;result('pending','No unique TMDB title/year/director/runtime match.');}
                    else {
                      let published=false;
                      for(const {rule,edition} of matchable.slice(0,2)) {
                        let checked:CheckResult;
                        try { checked=await dependencies.check(edition,rule.playbackOrigin!,signal,rule); }
                        catch { signal.throwIfAborted(); continue; }
                        signal.throwIfAborted();
                        if(Date.parse(rule.validUntil!)<=Date.now()) break;
                        await mutateRegistry(registryPath,'approve','',approvedSource(details,rule,edition,checked));
                        published=true; run.published++; result('published',`Published under policy ${rule.id}. ${checked.summary}`); break;
                      }
                      if (!published) {run.playbackFailed++;result('playback-failed','Compatible media could not be verified within the probe budget.');}
                    }
                  }
                }
              }
            } catch (error) {
              signal.throwIfAborted();
              run.errors++; result('import-error',formatError(error));
            }
          }
          state.cursors[scopeKey]={page:cursor.page,offset:index+1};
          await save(statePath,state);
        }
        state.cursors[scopeKey]={page:page.hasMore ? cursor.page+1 : 1,offset:0};
        await save(statePath,state);
      } catch(error) {
        run.errors++; run.messages.push(`${scopeKey}: ${formatError(error)}`);
      }
    }
    state.nextScope=(start+1)%config.discovery.length;
    run.endedAt=time();
    run.status=signal.aborted || run.errors ? 'partial':'complete';
    await save(statePath,state);
    return {state,skipped:false};
  } finally {
    try {await lock.close();} finally {await unlink(lockPath);}
  }
}
