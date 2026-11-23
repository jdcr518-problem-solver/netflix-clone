import { createHash } from 'node:crypto';
import { localAdminAllowed } from '../../../../lib/local-admin';
import { discoverFilms, getFilmCandidate, isProvider } from '../../../../lib/providers';
import type { FilmCandidate } from '../../../../lib/providers/blender';
import { tmdb } from '../../../../lib/tmdb';
import { mutateRegistry, RegistryConflict } from '../../../../lib/registry-file';
import { readRegistry, registryPath } from '../../../../lib/source-registry';
import { isReleaseMovie, safeEvidenceUrl, validReleaseReview } from '../../../../lib/registry-schema';
import { exactFilmMatch, type FilmMatch } from '../../../../lib/providers/matching';

const json = (body:unknown,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const hidden = () => new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});

async function findMatches(candidate:FilmCandidate):Promise<FilmMatch[]> {
  if (!candidate.year) return [];
  const data = await tmdb('/search/movie',{query:candidate.title,primary_release_year:String(candidate.year),include_adult:'false'});
  const matches = (data.results ?? []).filter((movie:FilmMatch) => exactFilmMatch(candidate,movie)).slice(0,8) as FilmMatch[];
  return Promise.all(matches.map(async match => {
    const details = await tmdb(`/movie/${match.id}`,{append_to_response:'credits'});
    return {...match,runtime:details.runtime,director:details.credits?.crew?.filter((entry:{job:string}) => entry.job === 'Director')
      .map((entry:{name:string}) => entry.name).join(', ')};
  }));
}

export async function GET(request:Request) {
  if (!localAdminAllowed(request.headers)) return hidden();
  const params = new URL(request.url).searchParams;
  const provider = params.get('provider');
  const id = params.get('id');
  if (!isProvider(provider)) return json({error:'Unknown provider.'},400);
  try {
    if (!id) return json({results:await discoverFilms(provider,params.get('q') ?? '')});
    const candidate = await getFilmCandidate(provider,id);
    if (!candidate) return json({error:'Candidate unavailable.'},404);
    const matches = await findMatches(candidate).catch(() => null);
    const registered = (await readRegistry()).filter(entry => entry.provenance?.provider === provider && entry.provenance.candidateId === id);
    return json({candidate,matches, editions:registered.map(entry => ({
      url:entry.url, approved:!!entry.provenance?.releaseReview, active:isReleaseMovie(entry),
      playbackNotes:entry.provenance?.releaseReview?.playbackNotes,
    }))});
  } catch { return json({error:'The provider could not be reached.'},503); }
}

export async function POST(request:Request) {
  if (!localAdminAllowed(request.headers,true)) return hidden();
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({error:'A review is required.'},400);
    const decoder = new TextDecoder();
    let content = '', size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) { await reader.cancel(); return json({error:'Review is too large.'},413); }
      content += decoder.decode(chunk.value,{stream:true});
    }
    const review = JSON.parse(content+decoder.decode());
    if (!review || !isProvider(review.provider) || typeof review.id !== 'string' ||
      typeof review.file !== 'string' || !Number.isSafeInteger(review.tmdbId) || review.tmdbId <= 0 ||
      review.approved !== true || !safeEvidenceUrl(review.evidenceUrl) || !validReleaseReview(review.releaseReview) || review.releaseReview.automation !== undefined)
      return json({error:'Complete the license and hosting evidence, credits and playback checks, then explicitly approve this edition.'},400);
    const required = {owner:200,permittedUse:500,attribution:300,commercialRestrictions:500};
    for (const [key,limit] of Object.entries(required)) {
      const value = review[key];
      if (typeof value !== 'string' || !value.trim() || value.length > limit)
        return json({error:`Complete the rights review field: ${key}.`},400);
    }
    const candidate = await getFilmCandidate(review.provider,review.id);
    const file = candidate?.files.find(entry => entry.name === review.file);
    if (!candidate || !file) return json({error:'The selected provider file is unavailable.'},409);
    const matches = await findMatches(candidate);
    const match = matches.find(value => value.id === review.tmdbId && exactFilmMatch(candidate,value));
    if (!match) return json({error:'The selected TMDB film does not match the provider title, year, and known credits.'},400);

    const sourceId = `film-${candidate.provider}-${createHash('sha256').update(file.url).digest('hex').slice(0,20)}`;
    const sources = await mutateRegistry(registryPath,'approve','',{
      id:sourceId,target:{namespace:'tmdb',type:'movie',tmdbId:match.id},url:file.url,format:file.format,
      label:`${candidate.provider === 'blender' ? 'Blender Open Movie' : 'Internet Archive'} · ${file.format.toUpperCase()}`,
      ...(review.includeSubtitles === true && candidate.subtitles.length ? {subtitles:candidate.subtitles} : {}),
      enabled:true,rightsReference:review.evidenceUrl,
      provenance:{provider:candidate.provider,candidateId:candidate.id,originalPage:candidate.originalPage,
        evidenceUrl:review.evidenceUrl,owner:review.owner.trim(),permittedUse:review.permittedUse.trim(),
        attribution:review.attribution.trim(),commercialRestrictions:review.commercialRestrictions.trim(),
        verifiedAt:new Date().toISOString(),status:'approved',releaseReview:review.releaseReview},
    });
    return json({sources,sourceId:sources.find(entry => entry.url === file.url && entry.target.namespace === 'tmdb' && entry.target.tmdbId === match.id)?.id ?? sourceId},201);
  } catch (error) {
    if (error instanceof RegistryConflict) return json({error:error.message},409);
    if (error instanceof SyntaxError) return json({error:'Invalid review data.'},400);
    if (error instanceof Error && error.message.includes('duplicate source ID'))
      return json({error:'This provider file is already registered.'},409);
    return json({error:'The approved source could not be registered. Check the provider and registry, then retry.'},503);
  }
}
