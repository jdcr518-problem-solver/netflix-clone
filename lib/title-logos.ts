import type { MediaItem } from '../types/movie';

export interface TmdbLogo {
  file_path: string;
  iso_639_1: string | null;
  width: number;
  height: number;
  vote_average?: number;
  vote_count?: number;
}

/** PNG logos preserve transparency. Prefer English, then language-neutral artwork. */
export function selectTitleLogo(logos: TmdbLogo[] = []): MediaItem['titleLogo'] {
  const languageRank = (logo: TmdbLogo) => logo.iso_639_1 === 'en' ? 0 : logo.iso_639_1 === null ? 1 : 2;
  const suitable = logos.filter(l => /^\/[\w.-]+\.png$/i.test(l.file_path) && l.width >= 100 && l.height > 0);
  suitable.sort((a, b) => languageRank(a) - languageRank(b)
    || (b.vote_average || 0) - (a.vote_average || 0)
    || (b.vote_count || 0) - (a.vote_count || 0)
    || b.width - a.width);
  const logo = suitable[0];
  return logo ? { url: `https://image.tmdb.org/t/p/w500${logo.file_path}`, width: logo.width, height: logo.height } : null;
}
