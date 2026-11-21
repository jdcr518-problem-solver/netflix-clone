import { MediaItem } from '../types/movie';
import { ALL_CATALOG_ITEMS } from './catalog';
import { RIGHTS_CLEARED_STREAMS } from './streaming';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
import { tmdbImage } from './tmdb-images';

function getApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
}

export async function fetchTrending(mediaType: 'all' | 'movie' | 'tv' = 'all'): Promise<MediaItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return ALL_CATALOG_ITEMS;
  }

  try {
    const res = await fetch(`${TMDB_BASE_URL}/trending/${mediaType}/week?api_key=${apiKey}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`TMDB error: ${res.statusText}`);
    const data = await res.json();
    return (data.results || []).filter((item: any) => item.media_type !== 'person').map(formatTmdbItem);
  } catch (err) {
    console.warn('TMDB fetch failed, falling back to local catalog:', err);
    return ALL_CATALOG_ITEMS;
  }
}

export async function searchTitles(query: string): Promise<MediaItem[]> {
  if (!query.trim()) return [];
  const apiKey = getApiKey();
  if (!apiKey) {
    const q = query.toLowerCase();
    return ALL_CATALOG_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.overview.toLowerCase().includes(q) ||
        item.genres.some((g) => g.toLowerCase().includes(q))
    );
  }

  try {
    const res = await fetch(`${TMDB_BASE_URL}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`TMDB error: ${res.statusText}`);
    const data = await res.json();
    return (data.results || []).filter((item: any) => item.media_type !== 'person').map(formatTmdbItem);
  } catch (err) {
    console.warn('TMDB search failed, falling back to local search:', err);
    const q = query.toLowerCase();
    return ALL_CATALOG_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.overview.toLowerCase().includes(q) ||
        item.genres.some((g) => g.toLowerCase().includes(q))
    );
  }
}

function formatTmdbItem(item: any): MediaItem {
  const isMovie = item.media_type === 'movie' || !!item.title;
  return {
    id: item.id,
    title: item.title || item.name || 'Untitled',
    type: isMovie ? 'movie' : 'series',
    overview: item.overview || 'No synopsis available.',
    backdropUrl: tmdbImage(item.backdrop_path, 'backdrop'),
    posterUrl: tmdbImage(item.poster_path, 'poster'),
    matchScore: Math.round((item.vote_average || 7) * 10),
    year: parseInt((item.release_date || item.first_air_date || '2024').slice(0, 4), 10),
    maturityRating: item.adult ? '18+' : '13+',
    duration: isMovie ? '2h 04m' : undefined,
    seasons: !isMovie ? 1 : undefined,
    genres: ['Featured'],
    videoUrl: RIGHTS_CLEARED_STREAMS.default,
  };
}
