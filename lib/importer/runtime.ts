import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverImportPage, getFilmCandidate } from '../providers/index.ts';
import { exactFilmMatch, type FilmMatch } from '../providers/matching.ts';
import { tmdb } from '../tmdb-fetch.ts';
import { checkOwnedMedia } from './owned-media.ts';
import { checkMedia } from './media.ts';
import { readImportState, synchronize } from './sync.ts';

const folder=()=>join(process.cwd(),'data');

async function config() {
  try {
    return JSON.parse((await readFile(join(folder(),'import-policy.local.json'),'utf8')).replace(/^\uFEFF/,''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    return JSON.parse((await readFile(join(folder(),'import-policy.example.json'),'utf8')).replace(/^\uFEFF/,''));
  }
}

export function importStatus() { return readImportState(join(folder(),'import-state.local.json')); }

export async function runImport(mode:'due'|'now',signal?:AbortSignal) {
  return synchronize(folder(),await config(),{
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
  },mode,signal);
}
