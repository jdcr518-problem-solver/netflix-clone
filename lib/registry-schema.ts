import type { MediaSource, SubtitleSource } from '../types/playback';
import { permitsPlayback, type PackageRights } from './package-rights.ts';

type Target =
  | { namespace: 'tmdb'; type: 'movie'; tmdbId: number }
  | { namespace: 'tmdb'; type: 'episode'; tmdbId: number; season: number; episode: number }
  | { namespace: 'demo'; type: 'movie'; demoId: string }
  | { namespace: 'demo'; type: 'episode'; demoId: string; season: number; episode: number };

export interface ReleaseReview {
  licenseName: string;
  licenseUrl: string;
  hostingEvidenceUrl: string;
  hostingNotes: string;
  playbackNotes: string;
  modificationNotice: string;
  creditsVerified: true;
  playbackPassed: true;
  automation?: { policyId:string; policyHash:string; validUntil:string; browserEvidenceUrl:string; durationSeconds:number; publisherMasterUrl?:string; mediaSha256?:string };
}

export interface FilmProvenance {
  provider: 'blender' | 'archive';
  candidateId: string;
  originalPage: string;
  evidenceUrl: string;
  owner: string;
  permittedUse: string;
  attribution: string;
  commercialRestrictions: string;
  verifiedAt: string;
  status: 'approved';
  releaseReview?: ReleaseReview;
}

export interface SupplierRelease {
  supplierId: string;
  packageId: string;
  title: string;
  year: number;
  durationSeconds: number;
  artwork?: {poster?: string; backdrop?: string};
  rights: PackageRights;
  playbackEvidenceUrl: string;
  stagedAssetSha256?: string;
  subtitleHashes?: Record<string,string>;
  audio: {label:string; language:string}[];
  tmdbEpisodeId?: number;
  nextEpisodeId?: string | null;
}

export interface RegistrySource {
  id: string;
  target: Target;
  url: string;
  format: 'mp4' | 'hls';
  label?: string;
  quality?: { height: number };
  subtitles?: SubtitleSource[];
  enabled: boolean;
  rightsReference: string;
  provenance?: FilmProvenance;
  supplierRelease?: SupplierRelease;
  createdAt: string;
  updatedAt: string;
}

type Fields = Record<string, unknown>;
const slug = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const integer = (v: unknown, min: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const nonempty = (v: unknown, max: number) => typeof v === 'string' && !!v.trim() && v.length <= max;
function fields(value: unknown, allowed: string[]): value is Fields {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));
}
function mediaUrl(value: unknown, extension: string, localSubtitle = false): boolean {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\?#%]/.test(value)) return false;
  if (localSubtitle && /^\/subtitles\/[a-zA-Z0-9_-]+\.vtt$/.test(value)) return true;
  if (!/^https:\/\//.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname.toLowerCase().endsWith(extension);
  } catch { return false; }
}
export function safeEvidenceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
export function validReleaseReview(value: unknown): value is ReleaseReview {
  return fields(value,['licenseName','licenseUrl','hostingEvidenceUrl','hostingNotes','playbackNotes','modificationNotice','creditsVerified','playbackPassed','automation'])
    && nonempty(value.licenseName,100) && safeEvidenceUrl(value.licenseUrl) && safeEvidenceUrl(value.hostingEvidenceUrl)
    && nonempty(value.hostingNotes,500) && nonempty(value.playbackNotes,500) && nonempty(value.modificationNotice,300)
    && value.creditsVerified === true && value.playbackPassed === true
    && (value.automation === undefined || (
      fields(value.automation,['policyId','policyHash','validUntil','browserEvidenceUrl','durationSeconds','publisherMasterUrl','mediaSha256'])
      && nonempty(value.automation.policyId,80)
      && typeof value.automation.policyHash === 'string' && /^[a-f0-9]{64}$/.test(value.automation.policyHash)
      && timestamp(value.automation.validUntil) && safeEvidenceUrl(value.automation.browserEvidenceUrl)
      && typeof value.automation.durationSeconds === 'number' && Number.isFinite(value.automation.durationSeconds)
      && value.automation.durationSeconds > 0
      && ((value.automation.publisherMasterUrl === undefined && value.automation.mediaSha256 === undefined)
        || (safeEvidenceUrl(value.automation.publisherMasterUrl) && typeof value.automation.mediaSha256 === 'string'
          && /^[a-f0-9]{64}$/.test(value.automation.mediaSha256)))));
}

export function isReleaseMovie(entry: RegistrySource) { return isReleaseMovieInCountry(entry); }

export function isReleaseMovieInCountry(entry: RegistrySource, country?: string) {
  return entry.enabled && entry.target.namespace === 'tmdb' && entry.target.type === 'movie'
    && (entry.supplierRelease ? permitsPlayback(entry.supplierRelease.rights,country) :
      entry.provenance?.status === 'approved' && validReleaseReview(entry.provenance.releaseReview)
      && (!entry.provenance.releaseReview.automation || Date.parse(entry.provenance.releaseReview.automation.validUntil) > Date.now()));
}

export function isReleaseEpisode(entry: RegistrySource,country?:string) {
  return entry.enabled && entry.target.namespace === 'tmdb' && entry.target.type === 'episode' &&
    !!entry.supplierRelease && permitsPlayback(entry.supplierRelease.rights,country);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

const language = (value:unknown) => typeof value === 'string' && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value);
const hash = (value:unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validPackageRights(value:unknown) {
  return fields(value,['licenseUrl','licenseName','holder','attribution','attributionUrl','distribution','territories','startsAt','expiresAt','hostingEvidenceUrl','hostEnforcement']) &&
    safeEvidenceUrl(value.licenseUrl) && nonempty(value.licenseName,100) && nonempty(value.holder,200) &&
    nonempty(value.attribution,300) && safeEvidenceUrl(value.attributionUrl) && safeEvidenceUrl(value.hostingEvidenceUrl) &&
    (value.distribution==='free-on-demand' || value.distribution==='paid-on-demand') &&
    timestamp(value.startsAt) && timestamp(value.expiresAt) && value.startsAt<value.expiresAt &&
    (value.territories==='worldwide'
      ? value.hostEnforcement==='dates' || value.hostEnforcement==='dates-and-territories'
      : Array.isArray(value.territories) && value.territories.length>0 && value.territories.length<=249 &&
        new Set(value.territories).size===value.territories.length && value.territories.every(code=>typeof code==='string' && /^[A-Z]{2}$/.test(code) && !['XX','ZZ'].includes(code)) &&
        value.hostEnforcement==='dates-and-territories');
}

function validSupplierRelease(value:unknown, target:Fields) {
  if (!fields(value,['supplierId','packageId','title','year','durationSeconds','artwork','rights','playbackEvidenceUrl','stagedAssetSha256','subtitleHashes','audio','tmdbEpisodeId','nextEpisodeId'])) return false;
  const next=value.nextEpisodeId;
  return [value.supplierId,value.packageId].every(id=>typeof id==='string' && slug.test(id)) &&
    nonempty(value.title,250) && integer(value.year,1888) && Number(value.year)<=2200 &&
    integer(value.durationSeconds,1) && Number(value.durationSeconds)<=86400 && validPackageRights(value.rights) &&
    safeEvidenceUrl(value.playbackEvidenceUrl) && (value.stagedAssetSha256===undefined || hash(value.stagedAssetSha256)) &&
    (value.artwork===undefined || (fields(value.artwork,['poster','backdrop']) && Object.values(value.artwork).every(safeEvidenceUrl))) &&
    (value.subtitleHashes===undefined || (!!value.subtitleHashes && typeof value.subtitleHashes==='object' && !Array.isArray(value.subtitleHashes) &&
      Object.entries(value.subtitleHashes).every(([id,digest])=>slug.test(id) && hash(digest)))) &&
    Array.isArray(value.audio) && value.audio.length<=32 && value.audio.every(track=>fields(track,['label','language']) && nonempty(track.label,100) && language(track.language)) &&
    (target.type==='episode' ? integer(value.tmdbEpisodeId,1) && (next===null || (typeof next==='string' && new RegExp(`^tv:${target.tmdbId}:season:(0|[1-9]\\d*):episode:[1-9]\\d*$`).test(next)))
      : next===undefined && value.tmdbEpisodeId===undefined);
}

export function validateRegistry(value: unknown, namespace: Target['namespace']): RegistrySource[] {
  if (!fields(value, ['version','sources']) || value.version !== 1 || !Array.isArray(value.sources))
    throw new Error('Expected registry version 1 with a sources array.');
  const ids = new Set<string>();
  for (const [index, entry] of value.sources.entries()) {
    const fail = (field: string): never => { throw new Error(`Source #${index + 1}: invalid ${field}.`); };
    if (!fields(entry, ['id','target','url','format','label','quality','subtitles','enabled','rightsReference','provenance','supplierRelease','createdAt','updatedAt'])) throw new Error(`Source #${index + 1}: unexpected fields.`);
    if (typeof entry.id !== 'string' || !slug.test(entry.id) || (namespace === 'tmdb' && /^demo-/i.test(entry.id))) fail('source ID');
    const id = entry.id as string;
    if (ids.has(id)) fail('duplicate source ID');
    ids.add(id);
    const target = entry.target;
    if (!fields(target, ['namespace','type',namespace === 'tmdb' ? 'tmdbId' : 'demoId','season','episode'])) throw new Error(`Source #${index + 1}: invalid target.`);
    if (target.namespace !== namespace || (namespace === 'tmdb' ? !integer(target.tmdbId, 1) : typeof target.demoId !== 'string' || !slug.test(target.demoId))) fail('target identity');
    if (target.type === 'episode' ? !integer(target.season, 0) || !integer(target.episode, 1)
      : target.type !== 'movie' || 'season' in target || 'episode' in target) fail('episode coordinates or media type');
    if (entry.format !== 'mp4' && entry.format !== 'hls') fail('format');
    if (!mediaUrl(entry.url, entry.format === 'hls' ? '.m3u8' : '.mp4')) fail('video URL');
    if (typeof entry.enabled !== 'boolean' || !nonempty(entry.rightsReference, 500)) fail('enabled status or rights reference');
    if (!timestamp(entry.createdAt) || !timestamp(entry.updatedAt) || entry.updatedAt < entry.createdAt) fail('timestamps');
    if (entry.label !== undefined && !nonempty(entry.label, 100)) fail('label');
    if (entry.supplierRelease !== undefined && (namespace!=='tmdb' || entry.provenance || !validSupplierRelease(entry.supplierRelease,target))) fail('supplier release evidence');
    if (entry.provenance !== undefined) {
      const p = entry.provenance;
      if (namespace !== 'tmdb' || target.type !== 'movie' ||
        !fields(p, ['provider','candidateId','originalPage','evidenceUrl','owner','permittedUse','attribution','commercialRestrictions','verifiedAt','status','releaseReview']) ||
        (p.provider !== 'blender' && p.provider !== 'archive') || p.status !== 'approved' ||
        !nonempty(p.candidateId,150) || !safeEvidenceUrl(p.originalPage) || !safeEvidenceUrl(p.evidenceUrl) ||
        !nonempty(p.owner,200) || !nonempty(p.permittedUse,500) || !nonempty(p.attribution,300) ||
        !nonempty(p.commercialRestrictions,500) || !timestamp(p.verifiedAt) || (p.releaseReview !== undefined && !validReleaseReview(p.releaseReview))) fail('film approval evidence');
    }
    if (entry.quality !== undefined && (!fields(entry.quality, ['height']) || !integer(entry.quality.height, 1))) fail('quality');
    if (entry.subtitles !== undefined) {
      if (!Array.isArray(entry.subtitles)) throw new Error(`Source #${index + 1}: invalid subtitles.`);
      const subtitleIds = new Set<string>();
      for (const sub of entry.subtitles) {
        if (!fields(sub, ['id','label','language','url']) || typeof sub.id !== 'string' || !slug.test(sub.id)
          || subtitleIds.has(sub.id) || !nonempty(sub.label, 100) || typeof sub.language !== 'string'
          || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(sub.language) || !mediaUrl(sub.url, '.vtt', true)) fail('subtitle');
        subtitleIds.add((sub as {id:string}).id);
      }
    }
  }
  return value.sources as RegistrySource[];
}

export function toMediaSource(entry: RegistrySource): MediaSource {
  const release=entry.supplierRelease;
  const rights=release?.rights;
  const target=entry.target;
  const progressId=release && target.namespace==='tmdb' ? target.type==='movie' ? `movie:${target.tmdbId}` : `tv:${target.tmdbId}:season:${target.season}:episode:${target.episode}` : undefined;
  return { id: entry.id, url: entry.url, format: entry.format, label: entry.label,
    quality: entry.quality, progressId, audioTracks:release?.audio.map((track,index)=>({...track,id:String(index)})),
    credit: rights ? {text:rights.attribution,origin:rights.attributionUrl,license:rights.licenseUrl,owner:rights.holder,licenseName:rights.licenseName} : entry.provenance ? {text:entry.provenance.attribution, origin:entry.provenance.originalPage, license:entry.provenance.releaseReview?.licenseUrl ?? entry.provenance.evidenceUrl,
      owner:entry.provenance.owner,licenseName:entry.provenance.releaseReview?.licenseName,
      modificationNotice:entry.provenance.releaseReview?.modificationNotice} : undefined, subtitles: entry.subtitles ?? [], availability: 'available' };
}

export function movieSources(entries: RegistrySource[], tmdbId: number): MediaSource[] {
  return entries.filter(({enabled,target}) => enabled && target.namespace === 'tmdb'
    && target.type === 'movie' && target.tmdbId === tmdbId).map(toMediaSource);
}

export function episodeSources(entries: RegistrySource[], tmdbId: number, season: number, episode: number): MediaSource[] {
  return entries.filter(({enabled,target}) => enabled && target.namespace === 'tmdb' && target.type === 'episode'
    && target.tmdbId === tmdbId && target.season === season && target.episode === episode).map(toMediaSource);
}
