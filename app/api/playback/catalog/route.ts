import { availableMovieIds } from '../../../../lib/source-registry';
import { trustedCountry } from '../../../../lib/package-rights';
import { normalize, tmdb } from '../../../../lib/tmdb';

export const dynamic = 'force-dynamic';

export async function GET(request:Request) {
  const ids = (await availableMovieIds(trustedCountry(request.headers))).slice(0,24);
  const results = await Promise.allSettled(ids.map(async id => {
    const movie = await tmdb(`/movie/${id}`);
    return movie.adult ? null : {...normalize(movie,'movie'),playbackAvailable:true};
  }));
  const items = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  const failed = results.some(result => result.status === 'rejected');
  return Response.json({items,failed}, {headers:{'Cache-Control':'private, no-store'}});
}
