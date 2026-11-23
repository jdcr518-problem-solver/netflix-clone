import { availableMovieIds } from '../../../../lib/source-registry';
import { trustedCountry } from '../../../../lib/package-rights';

export const dynamic = 'force-dynamic';

export async function GET(request:Request) {
  return Response.json(await availableMovieIds(trustedCountry(request.headers)), {headers:{'Cache-Control':'private, no-store'}});
}
