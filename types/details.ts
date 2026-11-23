import type { MediaItem } from './movie';

export interface SeasonSummary { number: number; name: string; count: number; poster: string }
export interface CatalogEpisode {
  id: string;
  number: number;
  title: string;
  overview?: string;
  runtime?: number;
  airDate?: string;
  artwork: string;
}
export interface SeasonDetails { poster: string; episodes: CatalogEpisode[] }
export interface TitleDetails {
  item: MediaItem;
  seasons: SeasonSummary[];
  videos: { name: string; url: string }[];
  similar: MediaItem[];
}
