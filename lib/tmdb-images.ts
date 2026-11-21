const BASE = 'https://image.tmdb.org/t/p';
export type TmdbImageKind = 'poster' | 'backdrop' | 'hero';
// TMDB configuration sizes: posters w342/w500/w780; backdrops w300/w780/w1280.
export function tmdbImage(path: string | null | undefined, kind: TmdbImageKind): string {
  if (!path || !/^\/[\w.-]+$/.test(path)) return '';
  const size = { poster: 'w500', backdrop: 'w780', hero: 'w1280' }[kind];
  return `${BASE}/${size}${path}`;
}
