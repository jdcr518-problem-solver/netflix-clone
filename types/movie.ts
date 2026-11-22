export type MediaType = 'movie' | 'series';

export interface MediaItem {
  id: number;
  tmdbId?: number;
  contentKey?: string;
  releaseDate?: string;
  rating?: number;
  runtime?: number;
  playbackAvailable?: boolean;
  title: string;
  type: MediaType;
  overview: string;
  backdropUrl: string;
  posterUrl: string;
  titleLogo?: { url: string; width: number; height: number } | null;
  matchScore: number;
  year: number;
  maturityRating: 'Not rated' | 'ALL' | '7+' | '13+' | '16+' | '18+' | 'TV-MA' | 'PG-13' | 'R';
  duration?: string;
  seasons?: number;
  genres: string[];
  isTop10?: boolean;
  rank?: number;
  isOriginal?: boolean;
  badgeText?: string; // e.g. "Recently Added", "New Season", "Top 10"
  videoUrl: string;
  cast?: string[];
  creator?: string;
}

export type CategoryRow = {
  id: string;
  title: string;
  type: 'landscape' | 'top10';
  items: MediaItem[];
};
