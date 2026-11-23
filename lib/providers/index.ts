import 'server-only';
import { blenderCandidate, searchBlender, type FilmCandidate, type ProviderFile } from './blender.ts';
import type { SubtitleSource } from '../../types/playback';

export type Provider = FilmCandidate['provider'];
export const isProvider = (value: unknown): value is Provider => value === 'archive' || value === 'blender';
const archiveIdentifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$/;
const string = (value: unknown) => typeof value === 'string' ? value.trim().slice(0,2000) : '';
const yearOf = (value: unknown) => Number(/^\d{4}/.exec(String(value))?.[0]) || undefined;
const archiveOrigin = 'https://archive.org';

async function archive(path: string, parameters?: URLSearchParams, signal?: AbortSignal) {
  const url = new URL(path,archiveOrigin);
  if (parameters) url.search = parameters.toString();
  const response = await fetch(url,{redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),next:{revalidate:300}});
  if (!response.ok) throw Object.assign(new Error('Internet Archive is temporarily unavailable.'),{status:response.status});
  return response.json();
}

const adapters = {
  blender:{
    search: async (query:string) => searchBlender(query),
    get: async (id:string) => blenderCandidate(id),
  },
  archive:{
    async search(query:string) {
      if (query.length < 2) return [];
      // Quote only ordinary title characters. The caller cannot change fields or the upstream host.
      const title = query.replace(/[^\p{L}\p{N} '-]/gu,' ').trim();
      if (title.length < 2) return [];
      const params = new URLSearchParams({q:`mediatype:movies AND title:"${title}"`,output:'json',rows:'12'});
      for (const field of ['identifier','title','year']) params.append('fl[]',field);
      const data = await archive('/advancedsearch.php',params);
      return (data.response?.docs ?? []).filter((item:{identifier:string}) => typeof item.identifier === 'string' && archiveIdentifier.test(item.identifier))
        .map((item:{identifier:string;title:string;year?:number}) => ({id:item.identifier,title:string(item.title),year:yearOf(item.year)}));
    },
    async get(id:string,signal?:AbortSignal): Promise<FilmCandidate|undefined> {
      if (!archiveIdentifier.test(id)) return;
      const data = await archive(`/metadata/${id}`,undefined,signal);
      const metadata = data.metadata;
      if (!metadata || metadata.mediatype !== 'movies' || !metadata.title) return;
      const files:ProviderFile[] = [];
      const subtitles:SubtitleSource[] = [];
      const subtitleNotes:string[] = [];
      const restricted = [data.is_dark,metadata['access-restricted-item'],metadata['no-download']].some(flag => Boolean(flag) && flag !== 'false' && flag !== '0');
      for (const file of (Array.isArray(data.files) ? data.files : []).slice(0,2000)) {
        const name = string(file.name);
        if (!name) continue;
        const isPrivate = Boolean(file.private) && file.private !== 'false' && file.private !== '0';
        if (restricted || isPrivate) continue;
        const safeName = /^[\w.-]+$/.test(name) && !name.startsWith('.');
        const url = `${archiveOrigin}/download/${id}/${name}`;
        if (/\.(mp4|m3u8)$/i.test(name) && safeName && files.length < 30) {
          files.push({name,url,format:/\.mp4$/i.test(name) ? 'mp4' : 'hls'});
        }
        if (/\.(vtt|srt)$/i.test(name) && subtitleNotes.length < 30) {
          const language = typeof file.language === 'string' && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(file.language) ? file.language : '';
          subtitleNotes.push(`${name}${language ? ` (${language})` : ' (language not supplied)'}`);
          if (language && safeName && /\.vtt$/i.test(name))
            subtitles.push({id:`archive-caption-${subtitleNotes.length}`,label:name,language,url});
        }
      }
      return {
        provider:'archive',id,collections:(Array.isArray(metadata.collection) ? metadata.collection : [metadata.collection]).filter((item:unknown):item is string => typeof item === 'string'),title:string(metadata.title),year:yearOf(metadata.year || metadata.date),
        description:string(metadata.description),owner:string(metadata.creator),originalPage:`${archiveOrigin}/details/${id}`,
        licenseClaim:string(metadata.licenseurl || metadata.rights) || undefined,files,subtitles,subtitleNotes,
        playbackNote:restricted ? 'The item is restricted. No playable files are offered.'
          : 'Archive metadata is an uploader claim. Verify the owner, the exact full film, distribution permission, and the host’s terms independently.',
      };
    },
  },
};

export const discoverFilms = (provider:Provider,query:string) => adapters[provider].search(query.trim().slice(0,100));
export const getFilmCandidate = (provider:Provider,id:string,signal?:AbortSignal) => adapters[provider].get(id,signal);


export async function discoverImportPage(provider:Provider,collection:string,page:number,pageSize:number,signal:AbortSignal) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(collection) || !Number.isInteger(page) || page < 1 || page > 1000
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new Error('Invalid provider page.');
  if (provider === 'blender') {
    if (collection !== 'blender-open-movies') return {ids:[],hasMore:false};
    const results = searchBlender('');
    return {ids:results.slice((page-1)*pageSize,page*pageSize).map(item=>item.id),hasMore:page*pageSize < results.length};
  }
  const params = new URLSearchParams({q:`mediatype:movies AND collection:${collection}`,output:'json',rows:String(pageSize),page:String(page)});
  params.append('fl[]','identifier');
  params.append('sort[]','identifier asc');
  const data = await archive('/advancedsearch.php',params,signal);
  if (!Array.isArray(data.response?.docs) || !Number.isInteger(data.response?.numFound)) throw new Error('Malformed discovery response.');
  return {ids:data.response.docs.flatMap(({identifier}: {identifier:unknown}) =>
    typeof identifier === 'string' && archiveIdentifier.test(identifier) ? [identifier] : []),
    hasMore:page < 1000 && page*pageSize < data.response.numFound};
}
