import type { MediaSource, PlaybackProgress, PlaybackOptions } from '../types/playback';
import type { MediaItem } from '../types/movie';

export const unavailable = (id: string): MediaSource =>
  ({id, format:'mp4', availability:'unavailable', subtitles:[]});

export function preferredSource(sources: MediaSource[], progress: Record<string, PlaybackProgress>) {
  return sources.filter(source => progress[source.id]?.position > 0 && !progress[source.id].completed)
    .sort((a,b) => progress[b.id].updatedAt - progress[a.id].updatedAt)[0] ?? sources[0];
}

export async function loadPlayback(item: MediaItem, signal?: AbortSignal): Promise<PlaybackOptions> {
  if (!item.tmdbId) return {availability:'unavailable', sources:[], episodes:[]};
  const type = item.type === 'series' ? 'tv' : 'movie';
  const response = await fetch(`/api/playback?type=${type}&id=${item.tmdbId}`, {signal});
  if (!response.ok) throw new Error('Playback lookup failed.');
  return response.json();
}
