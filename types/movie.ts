export type MediaType = 'movie' | 'series';

export interface MediaItem {
  id: number;
  title: string;
  type: MediaType;
  overview: string;
  backdropUrl: string;
  posterUrl: string;
  matchScore: number;
  year: number;
  maturityRating: 'ALL' | '7+' | '13+' | '16+' | '18+' | 'TV-MA' | 'PG-13' | 'R';
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
