import { PlaybackProgress } from '../types/playback';
const KEY='streamframe_playback_v1';
export function readProgress():Record<string,PlaybackProgress> {
 try { const data=JSON.parse(localStorage.getItem(KEY)||'{}'); if (!data || typeof data!=='object' || Array.isArray(data)) return {}; return Object.fromEntries(Object.entries(data).filter(([,v])=>{const p=v as PlaybackProgress;return p?.version===1&&Number.isFinite(p.position)&&p.position>=0&&Number.isFinite(p.duration)&&p.duration>0;})) as Record<string,PlaybackProgress>; } catch {return {};}
}
export function persistProgress(id:string,position:number,duration:number,ended=false) {
 if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(position))return;
 const all=readProgress();all[id]={version:1,id,position:Math.max(0,Math.min(position,duration)),duration,completed:ended||position/duration>=.95,updatedAt:Date.now()};
 try {localStorage.setItem(KEY,JSON.stringify(all));}catch{/* Storage disabled or full: playback remains usable. */}
}
