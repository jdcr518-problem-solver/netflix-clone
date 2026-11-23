import type { MediaItem } from '../types/movie';

export function contentPath(item: MediaItem) {
  return item.tmdbId ? `/${item.type === 'series' ? 'tv' : 'movie'}/${item.tmdbId}` : null;
}
