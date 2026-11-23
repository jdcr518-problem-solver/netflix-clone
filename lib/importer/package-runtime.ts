import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
import {productionOperation} from '../operations.ts';
import { tmdb } from '../tmdb-fetch.ts';
import { importSupplierPackage, type SupplierCatalog } from './supplier-package.ts';
import { operatorRegistry } from '../registry-runtime.ts';
import { externalAndStagedStorage } from './supplier-media.ts';

export async function runSupplierPackage(path:string,publish:boolean,signal:AbortSignal,digest?:string) {
  await productionOperation(publish?'publish':'validate-package');
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
    const bytes=await readFile(path,{signal});
    if(digest && createHash('sha256').update(bytes).digest('hex')!==digest) throw new Error('Reviewed package digest changed.');
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  }};
  return importSupplierPackage(operatorRegistry(),feed,{catalog,origins,storage:externalAndStagedStorage(data)},
    publish,signal);
}
