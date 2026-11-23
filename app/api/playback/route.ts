import { playbackOptions } from '../../../lib/source-registry';
import { trustedCountry } from '../../../lib/package-rights';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  const rawId = params.get('id') ?? '';
  const id = Number(rawId);
  if ((type !== 'movie' && type !== 'tv') || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id))
    return Response.json({error:'Invalid playback target.'}, {status:400});
  return Response.json(await playbackOptions(type, id, trustedCountry(request.headers)), {headers:{'Cache-Control':'private, no-store'}});
}
