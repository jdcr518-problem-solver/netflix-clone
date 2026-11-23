'use client';
import React,{useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {ArrowLeft,Play,Pause,RotateCcw,RotateCw,Volume2,VolumeX,Maximize,PictureInPicture2} from 'lucide-react';
import {MediaItem} from '../types/movie';
import {MediaSource,Episode} from '../types/playback';
import {loadPlayback,preferredSource,unavailable} from '../lib/streaming';
import {persistProgress,readProgress} from '../lib/playback-storage';
import {nextEpisodeIndex,progressKey,seekPosition,selectableTracks} from '../lib/playback-controls';
import './player.css';
const time=(n:number)=>!Number.isFinite(n)?'LIVE':`${Math.floor(n/3600)?Math.floor(n/3600)+':':''}${Math.floor(n/60)%60}:${String(Math.floor(n%60)).padStart(2,'0')}`;
type NativeAudioTrack = {label:string; language:string; enabled:boolean};
const nativeAudioTracks=(element:HTMLVideoElement)=> (element as HTMLVideoElement & {audioTracks?:EventTarget & ArrayLike<NativeAudioTrack>}).audioTracks;
export function VideoPlayer({item,onClose,source,sources,episodes=[],initialEpisodeId,recheckSources=false}:{item:MediaItem;onClose:()=>void;source?:MediaSource;sources?:MediaSource[];episodes?:Episode[];initialEpisodeId?:string;recheckSources?:boolean}) {
 const [index,setIndex]=useState(()=>Math.max(0,episodes.findIndex(e=>e.id===initialEpisodeId))),[attempt,setAttempt]=useState(0),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[buffer,setBuffer]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[visible,setVisible]=useState(true),[volume,setVolume]=useState(1),[muted,setMuted]=useState(false),[speed,setSpeed]=useState(1),[quality,setQuality]=useState(-1),[levels,setLevels]=useState<{height:number;bitrate:number}[]>([]),[audio,setAudio]=useState<{id:number;name:string}[]>([]),[audioId,setAudioId]=useState(0),[subtitles,setSubtitles]=useState(-1),[autoNext,setAutoNext]=useState(false),[pip,setPip]=useState(false),[fullscreen,setFullscreen]=useState(false);
 const video=useRef<HTMLVideoElement>(null),root=useRef<HTMLDivElement>(null),engine=useRef<Hls|null>(null),hide=useRef<ReturnType<typeof setTimeout>|null>(null),lastSave=useRef(0);
 const [embeddedCaptions, setEmbeddedCaptions] = useState<{id:number;name:string}[]>([]);
 const selected = episodes[index];
 const [choice, setChoice] = useState<{key:string; source?:MediaSource; sources:MediaSource[]}>();
 const [seekPreview,setSeekPreview] = useState<number>();
 const seekDrag = useRef<{pointer:number;position:number}|null>(null);
 const [checking, setChecking] = useState(false);
 const pending = useRef<AbortController | null>(null);
 const selectionKey = selected?.id ?? 'movie';
 const baseSource = selected?.source ?? source;
 const active = (choice?.key === selectionKey ? choice.source : baseSource) ?? unavailable(selectionKey);
 const choices = choice?.key === selectionKey ? choice.sources : selected?.sources ?? sources ?? [];
 const playable = active.availability === 'available' && !!active.url;
 const fallback = choices.find(entry => entry.id!==active.id && entry.availability === 'available' && entry.url);
 const nextIndex=nextEpisodeIndex(episodes,index);
 const recoveryPosition = useRef<{id:string;position:number}|undefined>(undefined);
 const nativeFullscreen = useRef(false);
 const interruptedPosition = useRef<number|undefined>(undefined);
 const playbackStarted = useRef<MediaSource | null>(null);
 const save = () => {
   const v = video.current;
   if (v && playable && playbackStarted.current?.id === active.id)
     persistProgress(progressKey(active),v.currentTime,v.duration,v.ended);
 };
 const reveal=()=>{setVisible(true);if(hide.current)clearTimeout(hide.current);hide.current=setTimeout(()=>{if(video.current&&!video.current.paused&&!(document.activeElement!==root.current&&root.current?.contains(document.activeElement)))setVisible(false);},3000);};
 const play=()=>{const v=video.current;if(!v||error)return;if(v.paused)v.play().catch(()=>{setNotice('Press Play to start playback.');setBusy(false);});else v.pause();};
 const seek = (seconds:number) => {
   const media = video.current;
   if (!media || media.readyState === 0 || error) return;
   const target=seekPosition(seconds,media.duration);
   if (target===undefined) return;
   media.currentTime = target;
   setPosition(media.currentTime);
 };
 const fs = async () => {
   const media = video.current as (HTMLVideoElement & {webkitEnterFullscreen?:()=>void;webkitExitFullscreen?:()=>void}) | null;
   try {
     if (document.fullscreenElement) { await document.exitFullscreen(); return; }
     if (nativeFullscreen.current && media?.webkitExitFullscreen) { media.webkitExitFullscreen(); return; }
     if (document.fullscreenEnabled && root.current?.requestFullscreen) {
       try { await root.current.requestFullscreen(); return; } catch { /* Try the native video control on iOS. */ }
     }
     if (media?.webkitEnterFullscreen) { media.webkitEnterFullscreen(); return; }
   } catch { /* Browser rejected fullscreen. */ }
   setNotice('Fullscreen is unavailable in this browser.');
 };
 const selectPlayback = async (nextIndex: number, sourceId?: string, offset?: number) => {
   save();
   const episode = episodes[nextIndex];
   const key = episode?.id ?? 'movie';
   const apply = (nextSources: MediaSource[]) => {
     const nextSource = sourceId ? nextSources.find(entry => entry.id === sourceId) : preferredSource(nextSources,readProgress());
     recoveryPosition.current = nextSource && offset !== undefined ? {id:nextSource.id,position:offset} : undefined;
     setChoice({key,source:nextSource,sources:nextSources});
     setIndex(nextIndex);
     setAttempt(value => value + 1);
     if (episode) {
       try { localStorage.setItem(`streamframe_episode_${item.id}`,episode.id); } catch {}
     }
   };
   if (!recheckSources) {
     if (episode && nextIndex !== index) {
       setIndex(nextIndex);
       try { localStorage.setItem(`streamframe_episode_${item.id}`,episode.id); } catch {}
     } else setAttempt(value => value + 1);
     return;
   }
   pending.current?.abort();
   const controller = new AbortController();
   pending.current = controller;
   setChecking(true);
   try {
     const latest = await loadPlayback(item,controller.signal);
     if (!controller.signal.aborted)
       apply(episode ? latest.episodes.find(entry => entry.id === key)?.sources ?? [] : latest.sources);
   } catch {
     if (!controller.signal.aborted) setNotice('Could not check playback availability. Please try again.');
   } finally {
     if (!controller.signal.aborted) setChecking(false);
   }
 };
 const changeEpisode = (nextIndex:number) => { void selectPlayback(nextIndex); };
 const selectAudio=(id:number)=>{
   setAudioId(id);
   if (engine.current) engine.current.audioTrack=id;
   else if (video.current) Array.from(nativeAudioTracks(video.current) ?? []).forEach((track,index)=>{track.enabled=index===id;});
 };
 useEffect(() => () => pending.current?.abort(), []);
 useEffect(()=>{if(initialEpisodeId)return;try{const id=localStorage.getItem(`streamframe_episode_${item.id}`);const found=episodes.findIndex(e=>e.id===id);if(found>=0)setIndex(found);}catch{}},[item.id,initialEpisodeId]);
 useEffect(()=>{
  const v=video.current;if(!v)return;let disposed=false;let recoveries=0;setPosition(0);setDuration(0);setBuffer(0);setPlaying(false);setError('');setNotice('');setBusy(!!playable);setLevels([]);setAudio([]);setEmbeddedCaptions([]);setQuality(-1);setSubtitles(-1);lastSave.current=0;
  playbackStarted.current = null;
  interruptedPosition.current = undefined;
  seekDrag.current = null;
  setSeekPreview(undefined);
  if(!playable)return;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  const clearStall = () => { clearTimeout(stallTimer); stallTimer = undefined; };
  const stopLoading = (message:string) => {
    if (disposed || failed) return;
    failed = true;
    interruptedPosition.current = v.currentTime;
    if (v.readyState >= 2 && !v.seeking) save();
    // Detaching HLS may reset currentTime. Ignore the ensuing pause and cleanup for progress.
    playbackStarted.current = null;
    clearStall();
    setError(message);
    setBusy(false);
    v.pause();
    const hls = engine.current;
    engine.current = null;
    hls?.destroy();
  };
  const watchStall = () => {
    // Repeated stalled/waiting events must not extend the same attempt indefinitely.
    if (failed || stallTimer !== undefined || (!v.seeking && v.readyState >= 3)) return;
    setBusy(true);
    stallTimer = setTimeout(() => {
      stopLoading('The source stopped responding. Try another available source, or retry this one.');
    }, 15000);
  };
  const ready = () => {
    if (!failed && !v.seeking && v.readyState >= 3) { clearStall(); setBusy(false); }
  };
  const nativeEntered = () => { nativeFullscreen.current = true; setFullscreen(true); };
  const nativeExited = () => { nativeFullscreen.current = false; setFullscreen(false); };
  const events = {
    waiting:watchStall, stalled:watchStall, seeking:watchStall, seeked:ready, canplay:ready, playing:ready,
    error:() => stopLoading('The video could not be loaded. The source may be unreachable or expired.'),
    webkitbeginfullscreen:nativeEntered, webkitendfullscreen:nativeExited,
  };
  for (const [name, listener] of Object.entries(events)) v.addEventListener(name,listener);
  const nativeTracks=nativeAudioTracks(v);
  const refreshNativeAudio=()=>{
    if (engine.current || !active.audioTracks) return;
    const tracks=Array.from(nativeTracks ?? []);
    setAudio(selectableTracks(tracks.map(track=>({name:track.label,lang:track.language})),active.audioTracks));
    setAudioId(tracks.findIndex(track=>track.enabled));
  };
  nativeTracks?.addEventListener('addtrack',refreshNativeAudio);
  nativeTracks?.addEventListener('change',refreshNativeAudio);
  watchStall();
  const resume = () => {
    if (failed || disposed) return;
    refreshNativeAudio();
    const saved = readProgress()[progressKey(active)];
    const recovery = recoveryPosition.current;
    if (recovery?.id === active.id) recoveryPosition.current = undefined;
    const start = recovery?.id === active.id ? recovery.position : saved && !saved.completed ? saved.position : 0;
    if (start > 0 && start < v.duration - 1) v.currentTime = start;
    setDuration(v.duration);
    v.playbackRate = speed;
    v.play().catch(() => {
      if (!disposed && !failed) { setNotice('Press Play to start playback.'); }
    });
  };
  v.addEventListener('loadedmetadata',resume,{once:true});
  if(active.format==='mp4')v.src=active.url!;
  else if(active.format==='hls'&&!Hls.isSupported()&&v.canPlayType('application/vnd.apple.mpegurl'))v.src=active.url!;
  else if(active.format==='hls'&&Hls.isSupported()){
   const h=new Hls();engine.current=h;h.loadSource(active.url!);h.attachMedia(v);
   const refreshAudio=()=>{const tracks=selectableTracks(h.audioTracks,active.audioTracks);setAudio(tracks);setAudioId(h.audioTrack);};
   h.on(Hls.Events.MANIFEST_PARSED,()=>{setLevels(h.levels.map(l=>({height:l.height,bitrate:l.bitrate})));refreshAudio();});
   h.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
     setEmbeddedCaptions(selectableTracks(h.subtitleTracks,active.progressId ? [] : undefined));
   });
   h.on(Hls.Events.AUDIO_TRACKS_UPDATED,refreshAudio);
   h.on(Hls.Events.AUDIO_TRACK_SWITCHED,(_,track)=>setAudioId(track.id));
   h.on(Hls.Events.ERROR,(_,data)=>{
     if (disposed || failed) return;
     if (!data.fatal) {
       if (v.seeking || v.readyState < 3) watchStall();
       return;
     }
     if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries++ < 1) {
       watchStall();
       h.recoverMediaError();
       return;
     }
     const status = data.response?.code;
     stopLoading(data.type === Hls.ErrorTypes.NETWORK_ERROR
       ? `The stream could not be loaded${status ? ` (HTTP ${status})` : ''}. Try another available source.`
       : 'This stream could not be decoded. Try another available source.');
   });
  } else { stopLoading('This video format is not supported by your browser.'); }
  const flush=()=>{if(playbackStarted.current?.id===active.id)persistProgress(progressKey(active),v.currentTime,v.duration,v.ended);};
  window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',flush);
  return () => {
    disposed = true;
    flush();
    clearStall();
    for (const [name, listener] of Object.entries(events)) v.removeEventListener(name,listener);
    v.removeEventListener('loadedmetadata',resume);
    nativeTracks?.removeEventListener('addtrack',refreshNativeAudio);
    nativeTracks?.removeEventListener('change',refreshNativeAudio);
    window.removeEventListener('pagehide',flush);
    document.removeEventListener('visibilitychange',flush);
    engine.current?.destroy();
    engine.current = null;
    nativeFullscreen.current = false;
    v.pause();
    v.removeAttribute('src');
    v.load();
  };
 },[active.id,active.url,active.format,playable,attempt]);
 useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';const focus=document.activeElement as HTMLElement;root.current?.focus();setPip(!!document.pictureInPictureEnabled);const sync=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',sync);return()=>{document.body.style.overflow=previous;if(hide.current)clearTimeout(hide.current);document.removeEventListener('fullscreenchange',sync);focus?.focus();};},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();if(!document.fullscreenElement&&!nativeFullscreen.current)onClose();return;}if((e.target as HTMLElement).closest('input,select,textarea,button,a,[contenteditable="true"]'))return;const k=e.key.toLowerCase();if(![' ','arrowleft','arrowright','f','m'].includes(k))return;e.preventDefault();reveal();if(k===' ')play();if(k==='arrowleft')seek((video.current?.currentTime||0)-10);if(k==='arrowright')seek((video.current?.currentTime||0)+10);if(k==='f')void fs();if(k==='m'&&video.current)video.current.muted=!video.current.muted;};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
 const selectSub=(i:number)=>{setSubtitles(i);const tracks=video.current?.querySelectorAll('track');tracks?.forEach((element,n)=>{element.track.mode=n===i?'showing':'disabled';});if(engine.current)engine.current.subtitleTrack=embeddedCaptions[i-active.subtitles.length]?.id ?? -1;};
 return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${item.title} player`} className={`sf-player ${visible||!playing||error?'':'sf-hidden'}`} onPointerMove={reveal} onPointerDown={reveal} onFocusCapture={()=>setVisible(true)}>
 <video key={active.id} ref={video} playsInline crossOrigin={active.format === 'hls' || active.id.startsWith('demo-') || active.subtitles.some(track => track.url.startsWith('https://')) ? 'anonymous' : undefined} onClick={error ? undefined : play} onPlaying={()=>{playbackStarted.current=active;setPlaying(true);setBusy(false);setNotice('');reveal();}} onPause={()=>{setPlaying(false);save();}} onDurationChange={()=>setDuration(video.current?.duration||0)} onVolumeChange={()=>{setVolume(video.current?.volume??1);setMuted(video.current?.muted??false);}} onTimeUpdate={()=>{const v=video.current!;setPosition(v.currentTime);if(Date.now()-lastSave.current>5000){save();lastSave.current=Date.now();}}} onProgress={()=>{const v=video.current!;if(v.buffered.length)setBuffer(v.buffered.end(v.buffered.length-1));}} onEnded={()=>{save();setPlaying(false);if(autoNext&&nextIndex>=0)changeEpisode(nextIndex);}}>
 {active.subtitles.map(s=><track key={s.id} kind="subtitles" src={s.url} srcLang={s.language} label={s.label}/>)}
 </video>
 <header><button aria-label="Back to browse" onClick={()=>{save();onClose();}}><ArrowLeft/></button><div><small>STREAMFRAME</small><h1>{item.title}</h1><p>{selected?`S${selected.season} · E${selected.number} — ${selected.title}`:active.label||'Movie'}</p>{active.credit && <p>{active.credit.text} · <a href={active.credit.license} target="_blank" rel="noreferrer">License evidence</a></p>}</div></header>
 {!playable||error?<div className="sf-message" role="alert"><h2>{!playable?'Video unavailable':'Playback interrupted'}</h2><p>{!playable?'An authorized video source is not available for this title.':error}</p>{(playable||recheckSources)&&<button disabled={checking} onClick={()=>void selectPlayback(index,playable ? active.id : undefined)}>Retry playback</button>}{fallback && <button disabled={checking} onClick={() => void selectPlayback(index,fallback.id,interruptedPosition.current ?? video.current?.currentTime)}>Switch source</button>}<button onClick={onClose}>Back to browse</button></div>:busy?<div className="sf-loading" role="status">Loading video…</div>:null}
 {notice&&!error&&<div className="sf-notice" role="status">{notice}</div>}
 <footer>
 {episodes.length>0&&<div className="sf-episodes"><label>Season <select aria-label="Season" value={selected.season} onChange={e=>changeEpisode(episodes.findIndex(x=>x.season===Number(e.target.value)))}>{[...new Set(episodes.map(e=>e.season))].map(s=><option key={s} value={s}>{s}</option>)}</select></label><label>Episode <select aria-label="Episode" value={index} onChange={e=>changeEpisode(Number(e.target.value))}>{episodes.map((e,i)=>e.season===selected.season&&<option key={e.id} value={i}>{e.number}. {e.title}{e.duration?` (${e.duration})`:''}</option>)}</select></label><button disabled={index===0} onClick={()=>changeEpisode(index-1)}>Previous episode</button><button disabled={nextIndex<0} onClick={()=>changeEpisode(nextIndex)}>Next episode</button><label><input type="checkbox" checked={autoNext} onChange={e=>setAutoNext(e.target.checked)}/> Auto-next</label></div>}
 <div className="sf-timeline"><div className="sf-buffer" style={{width:`${Number.isFinite(duration)&&duration?Math.min(100,buffer/duration*100):0}%`}}/><input style={{background:`linear-gradient(to right,#e50914 ${duration&&Number.isFinite(duration)?position/duration*100:0}%,transparent 0)`}} aria-label="Playback position" type="range" min={0} max={Number.isFinite(duration)?duration:0} step={.1} value={seekPreview ?? position} disabled={!playable||!!error||!duration||!Number.isFinite(duration)}
   onPointerDown={event => {
     seekDrag.current = {pointer:event.pointerId,position};
     event.currentTarget.setPointerCapture(event.pointerId);
     reveal();
   }}
   onPointerUp={event => {
     if (seekDrag.current?.pointer !== event.pointerId) return;
     const target = seekDrag.current.position;
     seekDrag.current = null;
     setSeekPreview(undefined);
     seek(target);
   }}
   onPointerCancel={() => { seekDrag.current = null; setSeekPreview(undefined); }}
   onChange={event => {
     const target = Number(event.target.value);
     if (seekDrag.current) { seekDrag.current.position = target; setSeekPreview(target); }
     else seek(target);
   }}/></div>
 <div className="sf-controls"><button disabled={!playable||!!error} aria-label={playing?'Pause':'Play'} onClick={play}>{playing?<Pause/>:<Play/>}</button><button disabled={!playable} aria-label="Rewind 10 seconds" onClick={()=>seek(position-10)}><RotateCcw/><span>10</span></button><button disabled={!playable} aria-label="Forward 10 seconds" onClick={()=>seek(position+10)}><RotateCw/><span>10</span></button><button aria-label={muted?'Unmute':'Mute'} onClick={()=>{if(video.current)video.current.muted=!muted;}}>{muted?<VolumeX/>:<Volume2/>}</button><input aria-label="Volume" className="sf-volume" type="range" min={0} max={1} step={.05} value={muted?0:volume} onChange={e=>{if(video.current){video.current.volume=Number(e.target.value);video.current.muted=Number(e.target.value)===0;}}}/><span className="sf-time">{time(position)} / {time(duration)}</span><div className="sf-options">
 {choices.length > 1 && <label>Source<select aria-label="Video source" disabled={checking}
   value={playable ? active.id : ''} onChange={event => void selectPlayback(index,event.target.value)}>
   {!playable && <option value="" disabled>Select a source</option>}
   {choices.map(entry => <option key={entry.id} value={entry.id}>{entry.label ?? entry.id}{entry.quality ? ` · ${entry.quality.height}p` : ''}</option>)}
 </select></label>}
 <label>Speed<select aria-label="Playback speed" value={speed} onChange={e=>{setSpeed(Number(e.target.value));if(video.current)video.current.playbackRate=Number(e.target.value);}}>{[.5,.75,1,1.25,1.5,2].map(s=><option key={s} value={s}>{s}×</option>)}</select></label>
 {levels.length>1&&<label>Quality<select aria-label="Quality" value={quality} onChange={e=>{setQuality(Number(e.target.value));if(engine.current)engine.current.currentLevel=Number(e.target.value);}}><option value={-1}>Auto</option>{levels.map((l,i)=><option key={i} value={i}>{l.height?`${l.height}p`:`${Math.round(l.bitrate/1000)} kbps`}</option>)}</select></label>}
 {(active.subtitles.length>0||embeddedCaptions.length>0)&&<label>Subtitles<select aria-label="Subtitles" value={subtitles} onChange={e=>selectSub(Number(e.target.value))}><option value={-1}>Off</option>{active.subtitles.map((s,i)=><option key={s.id} value={i}>{s.label}</option>)}{embeddedCaptions.map((track,i)=><option key={`embedded-${i}`} value={active.subtitles.length+i}>{track.name} (stream)</option>)}</select></label>}
 {audio.length>1&&<label>Audio<select aria-label="Audio track" value={audioId} onChange={e=>selectAudio(Number(e.target.value))}>{!audio.some(track=>track.id===audioId)&&<option value={audioId} disabled>Choose audio track</option>}{audio.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
 {pip&&playable&&<button aria-label="Picture in picture" onClick={async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.current?.requestPictureInPicture();}catch{setNotice('Picture-in-Picture is unavailable for this video.');}}}><PictureInPicture2/></button>}<button aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} onClick={()=>void fs()}><Maximize/></button></div></div>
 </footer></div>;
}

