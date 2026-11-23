import 'server-only';
import type {CatalogEpisode, SeasonDetails, SeasonSummary} from '../types/details';
import {selectTitleLogo} from './title-logos';
import {withPlaybackAvailability} from './source-registry';
import {MediaItem,CategoryRow} from '../types/movie';
import {tmdbImage} from './tmdb-images';
import {tmdb} from './tmdb-fetch';
export {tmdb} from './tmdb-fetch';
type Raw=Record<string,any>;
export const contentId=(id:number,type:'movie'|'tv')=>-(id*2+(type==='tv'?1:0));
export function normalize(d:Raw,type:'movie'|'tv',genres:Record<number,string>={}):MediaItem{
 const date=d.release_date||d.first_air_date||'';const runtime=d.runtime||d.episode_run_time?.[0];
 return {id:contentId(d.id,type),tmdbId:d.id,contentKey:`${type}:${d.id}`,title:d.title||d.name||'Untitled',type:type==='tv'?'series':'movie',overview:d.overview||'No synopsis available.',releaseDate:date,year:date?Number(date.slice(0,4)):0,backdropUrl:tmdbImage(d.backdrop_path,'backdrop'),posterUrl:tmdbImage(d.poster_path,'poster'),titleLogo:d.images?selectTitleLogo(d.images.logos):undefined,genres:d.genres?.map((g:Raw)=>g.name)||d.genre_ids?.map((id:number)=>genres[id]).filter(Boolean)||[],rating:typeof d.vote_average==='number'?d.vote_average:undefined,matchScore:Math.round((d.vote_average||0)*10),maturityRating:d.adult?'18+':'Not rated',duration:runtime?`${Math.floor(runtime/60)}h ${runtime%60}m`:undefined,runtime,seasons:d.number_of_seasons,cast:d.credits?.cast?.slice(0,10).map((p:Raw)=>p.name)||[],creator:d.created_by?.map((p:Raw)=>p.name).join(', ')||d.credits?.crew?.find((p:Raw)=>p.job==='Director')?.name,videoUrl:'',playbackAvailable:false};
}
async function genres(){const [m,t]=await Promise.all([tmdb('/genre/movie/list',{},86400),tmdb('/genre/tv/list',{},86400)]);return Object.fromEntries([...m.genres,...t.genres].map((g:Raw)=>[g.id,g.name]));}
export async function list(path:string,type:'movie'|'tv',params:Record<string,string>={}){const [data,g]=await Promise.all([tmdb(path,params),genres()]);return {items:await withPlaybackAvailability((data.results||[]).filter((d:Raw)=>!d.adult).map((d:Raw)=>normalize(d,type,g))),page:data.page||1,totalPages:Math.min(data.total_pages||1,500)};}
export async function catalog(){
 const definitions:[string,string,'movie'|'tv',Record<string,string>?][]=[['Trending Now','/trending/movie/week','movie'],['Popular on StreamFrame','/movie/popular','movie'],['Top 10 Movies','/movie/top_rated','movie'],['Top 10 TV Shows','/trending/tv/week','tv'],['Action Movies','/discover/movie','movie',{with_genres:'28'}],['Science Fiction','/discover/movie','movie',{with_genres:'878'}],['Comedy','/discover/movie','movie',{with_genres:'35'}],['Horror','/discover/movie','movie',{with_genres:'27'}],['Recently Released','/movie/now_playing','movie'],['Upcoming Movies','/movie/upcoming','movie']];
 let failures=0;const rows=await Promise.all(definitions.map(async([title,path,type,params],i)=>{try{const data=await list(path,type,params);const ranked=i===2||i===3;return {id:`tmdb-row-${i}`,title,type:ranked?'top10':'landscape',items:data.items.slice(0,ranked?10:20).map((item:MediaItem,index:number)=>({...item,isTop10:ranked,rank:ranked?index+1:undefined}))} as CategoryRow;}catch{failures++;return {id:`tmdb-row-${i}`,title,type:'landscape',items:[]} as CategoryRow;}}));
 let hero:MediaItem|undefined;try{hero=normalize(await tmdb('/tv/66732',{append_to_response:'credits'}),'tv');hero.backdropUrl='/artwork/101-backdrop.jpg'; /* Preserve approved hero artwork. */}catch{hero=rows.flatMap(r=>r.items).find(i=>i.backdropUrl);}
 return {rows,hero:hero||null,error:failures?'Some catalog sections are temporarily unavailable.':null};
}
export async function search(query:string,page:string){const [data,g]=await Promise.all([tmdb('/search/multi',{query,page,include_adult:'false'},300),genres()]);return {items:await withPlaybackAvailability((data.results||[]).filter((d:Raw)=>['movie','tv'].includes(d.media_type)&&!d.adult).map((d:Raw)=>normalize(d,d.media_type,g))),page:data.page,totalPages:Math.min(data.total_pages||1,500)};}
export async function details(type:'movie'|'tv',id:number){const d=await tmdb(`/${type}/${id}`,{append_to_response:'credits,videos,similar,recommendations,images',include_image_language:'en,null'});return {item:{...normalize(d,type),titleLogo:selectTitleLogo(d.images?.logos)||await titleLogo(type,id).catch(()=>null)},seasons:[...new Map<number, SeasonSummary>((d.seasons||[]).filter((s:Raw)=>Number.isInteger(s.season_number)&&s.season_number>=0).map((s:Raw)=>[s.season_number,{number:s.season_number,name:s.name,count:s.episode_count,poster:tmdbImage(s.poster_path,'poster')}])).values()].sort((a,b)=>(a.number||Infinity)-(b.number||Infinity)),videos:(d.videos?.results||[]).filter((v:Raw)=>v.site==='YouTube'&&/^[\w-]{11}$/.test(v.key)&&['Trailer','Teaser'].includes(v.type)).map((v:Raw)=>({name:v.name,url:`https://www.youtube.com/watch?v=${v.key}`})),similar:[...new Map([...(d.recommendations?.results||[]),...(d.similar?.results||[])].filter((x:Raw)=>!x.adult&&x.id!==id).map((x:Raw)=>[x.id,normalize(x,type)])).values()].slice(0,12)};}
export async function season(id:number,n:number): Promise<SeasonDetails> {
 const data = await tmdb(`/tv/${id}/season/${n}`);
 const episodes = new Map<number, CatalogEpisode>();
 for (const episode of data.episodes || []) {
   const number = episode.episode_number;
   if (!Number.isInteger(number) || number < 1) continue;
   episodes.set(number, {
     id: `tv:${id}:season:${n}:episode:${number}`,
     number, title: episode.name || `Episode ${number}`, overview: episode.overview,
     runtime: episode.runtime, airDate: episode.air_date,
     artwork: tmdbImage(episode.still_path,'backdrop'),
   });
 }
 return {poster:tmdbImage(data.poster_path,'poster'),episodes:[...episodes.values()].sort((a,b)=>a.number-b.number)};
}

export async function titleLogo(type: 'movie' | 'tv', id: number) {
 const data = await tmdb(`/${type}/${id}/images`, {language: ''}, 86400);
 return selectTitleLogo(data.logos);
}
