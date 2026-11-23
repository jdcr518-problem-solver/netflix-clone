import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { tmdb } from '../lib/tmdb-fetch.ts';
import { importSupplierPackage, type SupplierCatalog } from '../lib/importer/supplier-package.ts';
import { externalAndStagedStorage } from '../lib/importer/supplier-media.ts';

async function main() {
  if (process.env.NODE_ENV==='production') throw new Error('Supplier package imports are disabled in production.');
  const [path,option,extra]=process.argv.slice(2);
  if (!path || extra || (option && option!=='--publish')) throw new Error('Usage: npm run sources:package -- <manifest.json> [--publish]');
  try { loadEnvFile('.env.local'); } catch(error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  const data=join(process.cwd(),'data');
  const origins=new Set((process.env.STREAMFRAME_SUPPLIER_MEDIA_ORIGINS ?? '').split(',').map(value=>value.trim()).filter(Boolean));
  if (!origins.size || [...origins].some(origin=>!origin.startsWith('https://') || new URL(origin).origin!==origin))
    throw new Error('Set STREAMFRAME_SUPPLIER_MEDIA_ORIGINS to the reviewed HTTPS asset origins.');
  const nextSeasons=new Map<number,Set<number>>();
  const catalog:SupplierCatalog={
    async title(type,id,signal) {
      const value=await tmdb(`/${type}/${id}`,{},3600,signal);
      if (type==='tv') nextSeasons.set(id,new Set(value.seasons?.map((season:{season_number:number})=>season.season_number) ?? []));
      return {id:value.id,names:[value.title,value.original_title,value.name,value.original_name].filter(name=>typeof name==='string'),
        year:Number((value.release_date ?? value.first_air_date)?.slice(0,4)),durationMinutes:value.runtime,adult:value.adult};
    },
    async season(seriesId,season,signal) {
      const value=await tmdb(`/tv/${seriesId}/season/${season}`,{},3600,signal);
      if (value.season_number!==season || !Array.isArray(value.episodes)) throw new Error('TMDB did not return the requested season.');
      return {hasNextSeason:nextSeasons.get(seriesId)?.has(season+1) ?? false,
        episodes:value.episodes.filter((episode:{show_id?:number})=>episode.show_id===undefined || episode.show_id===seriesId).map(episode=>({
          id:episode.id,number:episode.episode_number,names:typeof episode.name==='string'?[episode.name]:[],
          year:Number(episode.air_date?.slice(0,4)),durationMinutes:episode.runtime,
        }))};
    },
  };
  const feed={async readPackage(signal:AbortSignal) {
    const info=await lstat(path);
    if (!info.isFile() || info.size>4_000_000) throw new Error('Package must be a regular JSON file up to 4 MB.');
    return JSON.parse((await readFile(path,{encoding:'utf8',signal})).replace(/^\uFEFF/,''));
  }};
  const result=await importSupplierPackage(join(data,'sources.local.json'),feed,{catalog,origins,storage:externalAndStagedStorage(data)},
    option==='--publish',AbortSignal.timeout(30*60*1000));
  console.log(JSON.stringify(result,null,2));
}

main().catch(error=>{
  console.error(error instanceof SyntaxError ? 'Invalid package JSON.' : error.code ? `Package operation failed (${error.code}).` : error.message);
  process.exitCode=1;
});
