import {createHash,createHmac, timingSafeEqual} from 'node:crypto';
import {isReleaseEpisode,isReleaseMovieInCountry,type RegistrySource} from './registry-schema.ts';

// A reserved DNS name lets the registry keep stable, non-secret object references.
export const objectOrigin='https://objects.streamframe.invalid';
const packagePath=/^\/([a-f0-9]{64})\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]*)$/;
export interface DeliveryConfig {origin?:string;secret?:string}
function revision(entry:RegistrySource) {
  const t=entry.target;
  const binding=[entry.id,t.namespace,t.type,t.namespace==='tmdb'?t.tmdbId:null,
    t.type==='episode'?t.season:null,t.type==='episode'?t.episode:null,entry.url,entry.createdAt,entry.updatedAt];
  return createHash('sha256').update(JSON.stringify(binding)).digest('base64url');
}
export function currentEdition(entry:RegistrySource|undefined,grant:{sourceId:string;revision:string},country?:string) {
  return !!entry && entry.id===grant.sourceId && revision(entry)===grant.revision &&
    (entry.target.type==='episode'?isReleaseEpisode(entry,country):isReleaseMovieInCountry(entry,country));
}
export function deliveryConfig():DeliveryConfig {
  return {origin:process.env.STREAMFRAME_DELIVERY_ORIGIN,secret:process.env.STREAMFRAME_DELIVERY_KEY};
}
function configured(config:DeliveryConfig) {
  return !!config.secret && Buffer.byteLength(config.secret)>=32 && !!config.origin &&
    /^https:\/\//.test(config.origin) && new URL(config.origin).origin===config.origin &&
    config.origin!==objectOrigin;
}
function sign(body:string,key:string) {
  return createHmac('sha256',key).update('streamframe-delivery-v1:'+body).digest('base64url');
}
export function deliver(entry:RegistrySource,country?:string,config=deliveryConfig()):RegistrySource|undefined {
  if (!(entry.target.type==='episode'?isReleaseEpisode(entry,country):isReleaseMovieInCountry(entry,country))) return;
  const locator=new URL(entry.url);
  if(locator.hostname!=='objects.streamframe.invalid') {
    if(entry.subtitles?.some(track=>new URL(track.url,objectOrigin+'/').hostname==='objects.streamframe.invalid' && !track.url.startsWith('/'))) return;
    return entry; // Existing external edition has its own reviewed hosting controls.
  }
  try {
    const path=packagePath.exec(locator.pathname);
    const release=entry.supplierRelease;
    if(entry.target.namespace!=='tmdb' || !configured(config) || !release || !path || locator.origin!==objectOrigin) return;
    const group=path[1];
    const until=Math.min(Date.parse(release.rights.expiresAt),Date.now()+(release.durationSeconds+900)*1000);
    const body=Buffer.from(JSON.stringify({group,id:entry.id,kind:entry.target.type==='movie'?'movie':'series',tmdbId:entry.target.tmdbId,revision:revision(entry),audience:config.origin,until,country:release.rights.territories==='worldwide'?null:country})).toString('base64url');
    const prefix=config.origin+'/v1/'+body+'.'+sign(body,config.secret!);
    const subtitles=(entry.subtitles??[]).map(track=>{
      const sub=new URL(track.url);
      if(sub.origin!==objectOrigin || packagePath.exec(sub.pathname)?.[1]!==group) throw new Error('Caption outside approved package');
      return {...track,url:prefix+sub.pathname};
    });
    return {...entry,url:prefix+locator.pathname,subtitles};
  } catch {return;}
}

// Called by a separate media gateway before every cache hit/origin read.
// country must come from the gateway's trusted geography service.
export function authorizedObject(request:URL,country:string|undefined,config:DeliveryConfig,now=Date.now()) {
  try {
    if(!configured(config) || request.origin!==config.origin || request.search || request.hash) return;
    const match=/^\/v1\/([\w-]{1,1024})\.([\w-]{43})(\/.*)$/.exec(request.pathname);
    if(!match || !timingSafeEqual(Buffer.from(match[2]),Buffer.from(sign(match[1],config.secret!)))) return;
    const path=packagePath.exec(match[3]);
    const grant=JSON.parse(Buffer.from(match[1],'base64url').toString('utf8'));
    if(!path || !['movie','series'].includes(grant.kind) || !Number.isSafeInteger(grant.tmdbId) || grant.tmdbId<1 || typeof grant.revision!=='string' || !/^[\w-]{43}$/.test(grant.revision) || grant.audience!==config.origin || grant.group!==path[1] || !Number.isFinite(grant.until) || now>=grant.until ||
      (grant.country!==null && (!country || country!==grant.country))) return;
    return {kind:grant.kind as 'movie'|'series',tmdbId:Number(grant.tmdbId),key:path[1]+'/'+path[2],sourceId:String(grant.id),revision:String(grant.revision),expiresAt:Number(grant.until)};
  } catch {return;}
}
