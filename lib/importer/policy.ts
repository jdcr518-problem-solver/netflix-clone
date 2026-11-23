import {createHash} from 'node:crypto';
import type { SubtitleSource } from '../../types/playback';
import type { FilmCandidate } from '../providers/blender';
import { safeEvidenceUrl } from '../registry-schema.ts';

type Provider = FilmCandidate['provider'];
export interface Policy {
  id:string;
  action:'preauthorize'|'review'|'deny';
  provider:Provider;
  collection:string;
  publisher:string;
  evidenceUrl?:string;
  hostingEvidenceUrl?:string;
  licenseName?:string;
  licenseUrl?:string;
  hostingNotes?:string;
  permittedUse?:string;
  restrictions?:string;
  attribution?:string;
  distribution?:'public-browser-direct'|'owned-same-origin';
  playbackOrigin?:string;
  validUntil?:string;
  editions?: Edition[];
}

export interface Edition {
  candidateId:string;
  rightsSnapshot?:string;
  url:string;
  format:'mp4'|'hls';
  tmdbId:number;
  title:string;
  year:number;
  director:string;
  durationSeconds:number;
  creditsVerified:true;
  browserPlaybackEvidenceUrl:string;
  ownedMasterUrl?:string;
  mediaSha256?:string;
  subtitles?: (SubtitleSource & {evidenceUrl:string})[];
  modificationNotice:string;
}

export interface ImportConfig {
  version:1;
  minimumIntervalMinutes:number;
  pageSize:number;
  discovery:{provider:Provider;collection:string}[];
  policies:Policy[];
}

const key = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const clean = (value:unknown,limit=500) => typeof value === 'string' && !!value.trim() && value.length <= limit;
const validProvider = (value:unknown) => value === 'blender' || value === 'archive';

export function approvedMediaUrl(value: string) {
  if (!value.startsWith('https://') || /[\s\\?#%]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.port || url.username || url.password) return false;
    switch (url.hostname) {
      case 'download.blender.org': return /^\/(?:demo\/movies|peach|durian|mango)\//.test(url.pathname);
      case 'archive.org': return /^\/download\/[\w.-]+\/[\w.=/-]+$/.test(url.pathname);
      case 'test-streams.mux.dev': return /^\/[\w-]+\/[\w.=/-]+$/.test(url.pathname);
      case 'demo.unified-streaming.com': return url.pathname.startsWith('/k8s/features/stable/video/tears-of-steel/');
      default: return false;
    }
  } catch { return false; }
}

const validDate = (value:unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const numberInRange = (value:unknown, min:number,max:number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
function origin(value:unknown) {
  if (typeof value !== 'string') return false;
  try { const url=new URL(value); return url.protocol === 'https:' && url.origin === value; }
  catch { return false; }
}

export function ownedEditionName(edition:Pick<Edition,'candidateId'|'url'|'format'|'mediaSha256'|'subtitles'>,playbackOrigin:string) {
  if (typeof edition.mediaSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(edition.mediaSha256)
    || !key.test(edition.candidateId) || edition.format !== 'mp4' || edition.subtitles?.length) return;
  const file = `${edition.candidateId}-${edition.mediaSha256}.mp4`;
  return edition.url === `${playbackOrigin}/streamframe-media/${file}` ? file : undefined;
}

export function parseConfig(value:unknown):ImportConfig {
  const config = value as ImportConfig;
  if (!config || config.version !== 1 || !numberInRange(config.minimumIntervalMinutes,1,10080)
    || !numberInRange(config.pageSize,1,10) || !Array.isArray(config.discovery) || !config.discovery.length || config.discovery.length > 12
    || !Array.isArray(config.policies) || config.policies.length > 100) throw new Error('Invalid import configuration.');
  const scopes = new Set<string>();
  for (const entry of config.discovery) {
    if (!entry || !validProvider(entry.provider) || typeof entry.collection !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(entry.collection))
      throw new Error('Invalid discovery scope.');
    const scope = `${entry.provider}:${entry.collection}`;
    if (scopes.has(scope)) throw new Error('Duplicate discovery scope.');
    scopes.add(scope);
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const rule of config.policies) {
    if (!rule || typeof rule.id !== 'string' || !key.test(rule.id) || ids.has(rule.id) || !validProvider(rule.provider)
      || typeof rule.collection !== 'string' || !key.test(rule.collection) || !clean(rule.publisher,200)
      || !['preauthorize','review','deny'].includes(rule.action)) throw new Error('Invalid or duplicate authorization policy.');
    ids.add(rule.id);
    if (rule.action !== 'preauthorize') continue;
    if ((rule.distribution !== 'public-browser-direct' && rule.distribution !== 'owned-same-origin') || !origin(rule.playbackOrigin)
      || !safeEvidenceUrl(rule.evidenceUrl) || !safeEvidenceUrl(rule.hostingEvidenceUrl) || !safeEvidenceUrl(rule.licenseUrl)
      || !clean(rule.licenseName,100) || !clean(rule.hostingNotes) || !clean(rule.permittedUse)
      || !validDate(rule.validUntil) || !clean(rule.restrictions) || !clean(rule.attribution,300) || !Array.isArray(rule.editions)
      || !rule.editions.length || rule.editions.length > 500) throw new Error(`Policy ${rule.id} lacks required authorization evidence.`);
    for (const edition of rule.editions) {
      if (!edition || typeof edition.candidateId !== 'string' || !key.test(edition.candidateId)
        || (edition.rightsSnapshot!==undefined && !/^[a-f0-9]{64}$/.test(edition.rightsSnapshot))
        || typeof edition.url !== 'string' || urls.has(edition.url)
        || (rule.distribution === 'owned-same-origin'
          ? rule.provider !== 'blender' || !safeEvidenceUrl(edition.ownedMasterUrl) || !ownedEditionName(edition,rule.playbackOrigin!)
          : !approvedMediaUrl(edition.url) || edition.ownedMasterUrl !== undefined || edition.mediaSha256 !== undefined)
        || !['mp4','hls'].includes(edition.format) || !edition.url.toLowerCase().endsWith(edition.format==='mp4'?'.mp4':'.m3u8')
        || !Number.isSafeInteger(edition.tmdbId) || edition.tmdbId <= 0 || !numberInRange(edition.year,1888,2200)
        || !numberInRange(edition.durationSeconds,60,21600) || edition.creditsVerified !== true || !safeEvidenceUrl(edition.browserPlaybackEvidenceUrl)
        || !clean(edition.title,250) || !clean(edition.director,250) || !clean(edition.modificationNotice,300))
        throw new Error(`Policy ${rule.id} contains an incomplete, duplicate, or unsafe edition.`);
      if (edition.subtitles !== undefined) {
        if (!Array.isArray(edition.subtitles) || edition.subtitles.length>4) throw new Error('Invalid subtitle policy.');
        const tracks=new Set<string>();
        for (const track of edition.subtitles) {
          if (!track || typeof track.id!=='string' || !key.test(track.id) || tracks.has(track.id) || !clean(track.label,100)
            || typeof track.language!=='string' || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(track.language)
            || typeof track.url!=='string' || !approvedMediaUrl(track.url) || !/\.vtt$/i.test(track.url)
            || !safeEvidenceUrl(track.evidenceUrl)) throw new Error('Invalid subtitle authorization evidence.');
          tracks.add(track.id);
        }
      }
      urls.add(edition.url);
    }
  }
  return config;
}

const normalize = (text:string) => text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function rightsSnapshot(candidate:FilmCandidate) {
  const evidence=[candidate.provider,candidate.id,candidate.owner,candidate.originalPage,candidate.licenseClaim,
    candidate.licenseUrl,candidate.evidence,candidate.attribution,candidate.creditsRequirement];
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
export function reviewedProductionPolicy(bytes:Buffer,expected:string|undefined) {
  if(createHash('sha256').update(bytes).digest('hex')!==expected) throw new Error('Reviewed import policy digest required.');
  const config=parseConfig(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
  if(config.policies.some(rule=>rule.action==='preauthorize' && rule.editions?.some(e=>!e.rightsSnapshot)))
    throw new Error('Production editions require pinned publisher rights metadata.');
  return config;
}

export function evaluatePolicy(config:ImportConfig,candidate:FilmCandidate) {
  const rules = config.policies.filter(rule => rule.provider === candidate.provider && candidate.collections?.includes(rule.collection)
    && (rule.publisher === '*' ? rule.action !== 'preauthorize' : normalize(rule.publisher) === normalize(candidate.owner)));
  if (rules.some(rule=>rule.action==='deny')) return {status:'rejected' as const,reason:'A policy denies this publisher or collection.'};
  if (rules.some(rule=>rule.action==='review')) return {status:'pending' as const,reason:'Policy requires manual evidence review.'};
  const eligible = rules.flatMap(rule => rule.action !== 'preauthorize' || Date.parse(rule.validUntil ?? '') <= Date.now() ? [] : (rule.editions ?? []).flatMap(edition => (
    (!edition.rightsSnapshot || edition.rightsSnapshot===rightsSnapshot(candidate)) && edition.candidateId === candidate.id && edition.year === candidate.year && normalize(edition.title) === normalize(candidate.title)
    && (!candidate.director || normalize(candidate.director) === normalize(edition.director))
    && (rule.distribution === 'owned-same-origin'
      ? candidate.publisherEditions?.some(master => master.url === edition.ownedMasterUrl)
      : candidate.files.some(file => file.url === edition.url && file.format === edition.format))
    && (edition.subtitles ?? []).every(track => candidate.subtitles.some(found => found.url === track.url && found.language === track.language))
  ) ? [{rule,edition}] : []));
  return eligible.length
    ? {status:'eligible' as const,editions:eligible.sort((a,b)=>Number(a.edition.format!=='mp4')-Number(b.edition.format!=='mp4'))}
    : {status:'pending' as const,reason:'No policy covers this exact file, publisher, collection and distribution method.'};
}

export function identity(value:string) { return normalize(value); }
