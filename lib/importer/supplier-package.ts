import { createHash } from 'node:crypto';
import { validateRegistry, type RegistrySource, type SupplierRelease } from '../registry-schema.ts';
import type { PackageRights } from '../package-rights.ts';
import { asRegistryStore, type RegistryStore } from '../registry-store.ts';
import { validateWebVtt, type MediaStorage, type StagedAsset } from './supplier-media.ts';

type Fields = Record<string,unknown>;
type PendingSource = Omit<RegistrySource,'createdAt'|'updatedAt'>;
type Identity = {id:number; names:string[]; year:number; durationMinutes?:number; adult?:boolean};
export type EpisodeIdentity = Identity & {number:number};
export interface SupplierCatalog {
  title(type:'movie'|'tv', id:number, signal:AbortSignal):Promise<Identity>;
  season(seriesId:number, season:number, signal:AbortSignal):Promise<{episodes:EpisodeIdentity[]; hasNextSeason:boolean}>;
}
// Future authorized feeds can supply the same untrusted package document as the local file CLI.
export interface SupplierFeed { readPackage(signal:AbortSignal):Promise<unknown> }

function object(value:unknown, keys:string[]):Fields {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key))) throw new Error('Invalid package object or unsupported field.');
  return value as Fields;
}
function array(value:unknown, max:number):unknown[] {
  if (!Array.isArray(value) || !value.length || value.length>max) throw new Error('Missing or oversized package list.');
  return value;
}
function number(value:unknown, min:number, max:number) {
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<min || value>max) throw new Error('Invalid package number.');
  return value;
}
function string(value:unknown,max=250) {
  if (typeof value!=='string' || !value.trim() || value.length>max) throw new Error('Invalid package text.');
  return value;
}
function key(value:unknown) {
  const id=string(value,80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Invalid package identifier.');
  return id;
}
function staged(value:unknown) {
  const asset=object(value,['file','sha256']);
  const sha256=string(asset.sha256,64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Expected a lowercase SHA-256.');
  return {file:string(asset.file,160),sha256};
}

const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu,'');
function match(identity:Identity,id:number,title:string,year:number,runtime?:number) {
  if (identity.adult || identity.id!==id || identity.year!==year || !identity.names.some(name=>normalized(name)===normalized(title)))
    throw new Error('Package title, year or identifier does not match TMDB.');
  if (runtime && identity.durationMinutes && Math.abs(identity.durationMinutes*60-runtime)>Math.max(120,runtime*0.05))
    throw new Error('Edition duration differs from TMDB beyond the matching tolerance.');
}

interface PackageDependencies {catalog:SupplierCatalog; storage:MediaStorage; origins:ReadonlySet<string>}

export async function prepareSupplierPackage(value:unknown,{catalog,storage,origins}:PackageDependencies,signal:AbortSignal) {
  const manifest=object(value,['version','supplierId','packageId','rights','titles']);
  if (manifest.version!==1) throw new Error('Unsupported supplier package version.');
  const supplierId=key(manifest.supplierId), packageId=key(manifest.packageId);
  const rights=manifest.rights as PackageRights;
  const sources:PendingSource[]=[];
  const stagedVideo=new Map<string,StagedAsset>();
  const stagedCaptions=new Map<string,StagedAsset>();
  const titles=new Set<string>();
  const urls=new Set<string>();
  const approvedAsset=(value:unknown)=>{
    const url=string(value,2048);
    const parsed=new URL(url);
    if (parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !origins.has(parsed.origin))
      throw new Error('Media and artwork must use a configured HTTPS supplier origin without credentials.');
    return url;
  };
  function addSources(input:unknown,target:RegistrySource['target'],title:string,year:number,durationSeconds:number,
    artwork:SupplierRelease['artwork'],episode?:Pick<SupplierRelease,'tmdbEpisodeId'|'nextEpisodeId'>) {
    for (const raw of array(input,8)) {
      if (sources.length>=2_000) throw new Error('Split packages larger than 2,000 media sources.');
      const source=object(raw,['id','url','format','label','enabled','audio','subtitles','staged','review']);
      const url=approvedAsset(source.url);
      if (urls.has(url)) throw new Error('Duplicate media URL in supplier package.');
      urls.add(url);
      const sourceKey=key(source.id);
      const id=`supplier-${createHash('sha256').update(`${supplierId}:${sourceKey}`).digest('hex').slice(0,32)}`;
      const review=object(source.review,['evidenceUrl','playbackPassed','seekPassed','resumePassed','creditsVerified','hostControlsVerified','trackSelectionPassed']);
      if (![review.playbackPassed,review.seekPassed,review.resumePassed,review.creditsVerified,review.hostControlsVerified].every(item=>item===true))
        throw new Error('Edition playback, credits and hosting checks must be reviewed.');
      if (source.enabled!==undefined && typeof source.enabled!=='boolean') throw new Error('Invalid source enablement.');
      const audio=source.audio===undefined ? [] : array(source.audio,32).map(track=>object(track,['language','label'])) as SupplierRelease['audio'];
      const subtitleHashes:Record<string,string>=Object.create(null);
      const subtitles=source.subtitles===undefined ? [] : array(source.subtitles,32).map(rawTrack=>{
        const track=object(rawTrack,['id','label','language','url','staged']);
        const subId=key(track.id);
        const asset=staged(track.staged);
        const subUrl=approvedAsset(track.url);
        if (!subUrl.endsWith(`/${asset.file}`)) throw new Error('WebVTT URL must identify the reviewed content-addressed file.');
        subtitleHashes[subId]=asset.sha256;
        stagedCaptions.set(`${id}:${subId}`,asset);
        return {id:subId,label:string(track.label,100),language:string(track.language,35),url:subUrl};
      });
      if ((audio.length>1 || subtitles.length) && review.trackSelectionPassed!==true) throw new Error('Track selection review is required.');
      const asset=source.staged===undefined ? undefined : staged(source.staged);
      if (asset) stagedVideo.set(id,asset);
      sources.push({id,target,url,format:source.format as RegistrySource['format'],label:source.label===undefined ? undefined : string(source.label,100),
        enabled:source.enabled!==false,subtitles,rightsReference:rights?.licenseUrl,
        supplierRelease:{supplierId,packageId,title,year,durationSeconds,artwork,rights,
          playbackEvidenceUrl:string(review.evidenceUrl,500),stagedAssetSha256:asset?.sha256,subtitleHashes,audio,...episode}});
    }
  }

  for (const raw of array(manifest.titles,100)) {
    signal.throwIfAborted();
    const title=object(raw,['type','tmdbId','title','year','durationSeconds','artwork','sources','seasons']);
    if (title.type!=='movie' && title.type!=='tv') throw new Error('Invalid package media type.');
    const id=number(title.tmdbId,1,Number.MAX_SAFE_INTEGER), year=number(title.year,1888,2200), name=string(title.title);
    const titleKey=`${title.type}:${id}`;
    if (titles.has(titleKey)) throw new Error('Duplicate movie or series in supplier package.');
    titles.add(titleKey);
    let artwork:SupplierRelease['artwork'];
    if (title.artwork!==undefined) {
      const image=object(title.artwork,['poster','backdrop']);
      artwork={...(image.poster!==undefined && {poster:approvedAsset(image.poster)}),...(image.backdrop!==undefined && {backdrop:approvedAsset(image.backdrop)})};
    }
    const identity=await catalog.title(title.type,id,signal);
    if (title.type==='movie') {
      if (title.seasons!==undefined) throw new Error('Movie packages cannot contain seasons.');
      const duration=number(title.durationSeconds,1,86400);
      match(identity,id,name,year,duration);
      addSources(title.sources,{namespace:'tmdb',type:'movie',tmdbId:id},name,year,duration,artwork);
      continue;
    }
    if (title.sources!==undefined || title.durationSeconds!==undefined) throw new Error('TV playback sources belong to exact episodes.');
    match(identity,id,name,year);
    const seasons=new Set<number>();
    for (const rawSeason of array(title.seasons,100)) {
      const season=object(rawSeason,['number','complete','episodes']);
      const index=number(season.number,0,999);
      if (seasons.has(index) || typeof season.complete!=='boolean') throw new Error('Duplicate season or missing completeness declaration.');
      seasons.add(index);
      const actual=await catalog.season(id,index,signal);
      const expected=new Map(actual.episodes.map(episode=>[episode.number,episode]));
      const provided=new Set<number>();
      for (const rawEpisode of array(season.episodes,500)) {
        const episode=object(rawEpisode,['number','tmdbEpisodeId','title','year','durationSeconds','sources']);
        const episodeNumber=number(episode.number,1,9999), episodeId=number(episode.tmdbEpisodeId,1,Number.MAX_SAFE_INTEGER);
        const found=expected.get(episodeNumber);
        if (!found || provided.has(episodeNumber)) throw new Error('Duplicate or unknown TMDB episode coordinate.');
        provided.add(episodeNumber);
        const episodeTitle=string(episode.title), episodeYear=number(episode.year,1888,2200), duration=number(episode.durationSeconds,1,86400);
        match(found,episodeId,episodeTitle,episodeYear,duration);
        const next=expected.has(episodeNumber+1) ? `tv:${id}:season:${index}:episode:${episodeNumber+1}` :
          index>0 && episodeNumber===Math.max(...expected.keys()) && actual.hasNextSeason ? `tv:${id}:season:${index+1}:episode:1` : null;
        addSources(episode.sources,{namespace:'tmdb',type:'episode',tmdbId:id,season:index,episode:episodeNumber},episodeTitle,episodeYear,duration,artwork,
          {tmdbEpisodeId:episodeId,nextEpisodeId:next});
      }
      if (season.complete && provided.size!==expected.size) throw new Error('Complete season is missing one or more TMDB episodes.');
    }
  }

  const timestamp=new Date().toISOString();
  validateRegistry({version:1,sources:sources.map(source=>({...source,createdAt:timestamp,updatedAt:timestamp}))},'tmdb');
  for (const source of sources) {
    signal.throwIfAborted();
    const duration=source.supplierRelease!.durationSeconds;
    await storage.verifyVideo(source.url,source.format,duration,stagedVideo.get(source.id),signal);
    for (const track of source.subtitles ?? []) {
      const text=await storage.readSubtitle(stagedCaptions.get(`${source.id}:${track.id}`)!,signal);
      validateWebVtt(text,duration);
    }
  }
  return sources;
}

export async function importSupplierPackage(path:string|RegistryStore,feed:SupplierFeed,dependencies:PackageDependencies,publish:boolean,signal:AbortSignal) {
  const sources=await prepareSupplierPackage(await feed.readPackage(signal),dependencies,signal);
  signal.throwIfAborted();
  if (publish) await asRegistryStore(path).mutate('approve-package','',sources);
  return {sources:sources.length,movies:new Set(sources.flatMap(({target})=>target.namespace==='tmdb' && target.type==='movie' ? [target.tmdbId] : [])).size,
    episodes:new Set(sources.flatMap(({target})=>target.namespace==='tmdb' && target.type==='episode' ? [`${target.tmdbId}:${target.season}:${target.episode}`] : [])).size,
    series:new Set(sources.flatMap(({target})=>target.namespace==='tmdb' && target.type==='episode' ? [target.tmdbId] : [])).size,publishedToRegistry:publish};
}
