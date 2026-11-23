import 'server-only';
import { readerRegistry } from './registry-runtime.ts';
import { episodeSources, isReleaseEpisode, isReleaseMovieInCountry, movieSources, type RegistrySource } from './registry-schema.ts';
import type { MediaItem } from '../types/movie';
import type { PlaybackOptions } from '../types/playback';

export { registryPath } from './registry-runtime.ts';

export async function readRegistry(target?: {type:'movie'|'tv';id:number}) {
  try {
    return await readerRegistry().read(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Video registry could not be read or validated. Catalog playback is unavailable.');
    return [];
  }
}

export async function availableMovieIds(country?:string) {
  const entries = await readRegistry();
  return [...new Set(entries.filter(entry=>isReleaseMovieInCountry(entry,country)).flatMap(({target}) =>
    target.type === 'movie' && target.namespace === 'tmdb' ? [target.tmdbId] : []))];
}

export async function withPlaybackAvailability(items: MediaItem[]) {
  const movies = new Set(await availableMovieIds());
  return items.map(item => ({...item, playbackAvailable: item.type === 'movie' && movies.has(item.tmdbId ?? 0)}));
}

export async function playbackOptions(type: 'movie' | 'tv', id: number, country?:string): Promise<PlaybackOptions> {
  return resolvePlayback(await readRegistry({type,id}),type,id,country);
}

export function resolvePlayback(entries:RegistrySource[],type:'movie'|'tv',id:number,country?:string):PlaybackOptions {
  if (type === 'movie') {
    const released = entries.filter(entry=>entry.target.namespace==='tmdb' && entry.target.tmdbId===id && isReleaseMovieInCountry(entry,country));
    const sources = movieSources(released, id);
    return { availability: sources.length ? 'available' : 'unavailable', sources, episodes: [],artwork:released.find(entry=>entry.supplierRelease?.artwork)?.supplierRelease?.artwork };
  }
  const released=entries.filter(entry=>entry.target.namespace==='tmdb' && entry.target.tmdbId===id && isReleaseEpisode(entry,country));
  const coordinates = new Map<string, { season:number; number:number; title:string; duration:string; nextEpisodeId?:string|null }>();
  for (const {target,supplierRelease} of released) {
    if (target.namespace !== 'tmdb' || target.type !== 'episode' || target.tmdbId !== id || !supplierRelease) continue;
    const key=`tv:${id}:season:${target.season}:episode:${target.episode}`;
    if (!coordinates.has(key)) coordinates.set(key,{season:target.season,number:target.episode,title:supplierRelease.title,
      duration:`${Math.round(supplierRelease.durationSeconds/60)} min`,nextEpisodeId:supplierRelease.nextEpisodeId});
  }
  const episodes = [...coordinates].map(([key, episode]) => {
    const sources = episodeSources(released, id, episode.season, episode.number);
    return {...episode,id:key,source:sources[0],sources};
  }).sort((a,b) => a.season-b.season || a.number-b.number);
  return { availability: episodes.length ? 'available' : 'unavailable', sources: [], episodes,artwork:released.find(entry=>entry.supplierRelease?.artwork)?.supplierRelease?.artwork };
}
