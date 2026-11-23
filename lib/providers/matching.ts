import type { FilmCandidate } from './blender';

export interface FilmMatch {
  id:number; title:string; original_title?:string; release_date:string;
  overview?:string; runtime?:number; director?:string;
}

const normalized = (value:string) => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

export function exactFilmMatch(candidate:Pick<FilmCandidate,'title'|'year'|'director'>,movie:FilmMatch) {
  return Boolean(candidate.year && movie.release_date?.slice(0,4) === String(candidate.year) &&
    [movie.title,movie.original_title].some(title => title && normalized(title) === normalized(candidate.title)) &&
    (!candidate.director || !movie.director ||
      movie.director.split(',').some(name => normalized(name) === normalized(candidate.director!))));
}
