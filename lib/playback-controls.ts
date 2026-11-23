import type { Episode, MediaSource } from '../types/playback';

export const progressKey=(source:MediaSource)=>source.progressId ?? source.id;

export function seekPosition(seconds:number,duration:number) {
  return Number.isFinite(seconds) && Number.isFinite(duration) && duration>0
    ? Math.min(Math.max(0,duration-0.05),Math.max(0,seconds)) : undefined;
}

export function nextEpisodeIndex(episodes:Episode[],index:number) {
  const next=episodes[index]?.nextEpisodeId;
  if (next===undefined) return index+1<episodes.length ? index+1 : -1;
  return next===null ? -1 : episodes.findIndex(episode=>episode.id===next);
}

export function selectableTracks(tracks: {name?:string;lang?:string}[], declared?: {label:string;language:string}[]) {
  return tracks.flatMap((track,id)=>{
    const language=track.lang?.toLowerCase();
    const approved=declared?.find(item=>item.language.toLowerCase()===language && item.label===track.name) ??
      declared?.find(item=>item.language.toLowerCase()===language);
    if (declared && !approved) return [];
    return [{id,name:approved?.label ?? ([track.name,track.lang!==track.name ? track.lang : undefined].filter(Boolean).join(' · ') || `Track ${id+1}`)}];
  });
}
