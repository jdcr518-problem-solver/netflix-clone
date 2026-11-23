import 'server-only';
import {reviewedProductionPolicy} from './policy.ts';
import {productionOperation} from '../operations.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverImportPage, getFilmCandidate } from '../providers/index.ts';
import { exactFilmMatch, type FilmMatch } from '../providers/matching.ts';
import { tmdb } from '../tmdb-fetch.ts';
import { checkOwnedMedia } from './owned-media.ts';
import { checkMedia } from './media.ts';
import { readImportState, synchronize } from './sync.ts';
import { operatorRegistry } from '../registry-runtime.ts';
import { PostgresRegistry } from '../database/registry.ts';

const folder=()=>join(process.cwd(),'data');

async function config(secured:boolean) {
  if(secured) {
    const bytes=await readFile(join(folder(),'import-policy.local.json'));
    return reviewedProductionPolicy(bytes,process.env.STREAMFRAME_POLICY_SHA256);
  }
  try {
    return JSON.parse((await readFile(join(folder(),'import-policy.local.json'),'utf8')).replace(/^\uFEFF/,''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    return JSON.parse((await readFile(join(folder(),'import-policy.example.json'),'utf8')).replace(/^\uFEFF/,''));
  }
}

export function importStatus() {
  const store=operatorRegistry();
  return store instanceof PostgresRegistry ? store.checkpoint('publisher-sync') : readImportState(join(folder(),'import-state.local.json'));
}

export async function runImport(mode:'due'|'now',signal?:AbortSignal) {
  const store=operatorRegistry();
  const identity=await productionOperation('sync');
  const configuration=await config(Boolean(identity));
  const dependencies:Parameters<typeof synchronize>[2]={
    discover:(scope,page,size,signal)=>discoverImportPage(scope.provider,scope.collection,page,size,signal),
    get:getFilmCandidate,
    async matches(candidate,signal){
      if (!candidate.year) return [];
      const data=await tmdb('/search/movie',{query:candidate.title,primary_release_year:String(candidate.year),include_adult:'false'},3600,signal);
      if (!Array.isArray(data.results) || !Number.isInteger(data.total_pages) || data.total_pages>1) return [];
      const results=data.results.filter((movie:FilmMatch & {adult?:boolean})=>!movie.adult && Number.isSafeInteger(movie.id) && movie.id>0 && exactFilmMatch(candidate,movie));
      if (results.length>5) return [];
      const matches:FilmMatch[]=[];
      for (const movie of results) {
        signal.throwIfAborted();
        const detail=await tmdb(`/movie/${movie.id}`,{append_to_response:'credits'},3600,signal);
        matches.push({...movie,runtime:detail.runtime,director:detail.credits?.crew
          ?.filter((entry:{job:string})=>entry.job==='Director').map((entry:{name:string})=>entry.name).join(', ')});
      }
      return matches;
    },
    check:(edition,origin,deadline,rule)=>rule.distribution === 'owned-same-origin'
      ? checkOwnedMedia(folder(),edition,origin,deadline) : checkMedia(edition,origin,deadline),
  };
  return store instanceof PostgresRegistry
    ? store.withImportSession('publisher-sync',session=>synchronize(folder(),configuration,dependencies,mode,signal,session))
    : synchronize(folder(),configuration,dependencies,mode,signal);
}
