'use client';
import {useState,useEffect} from 'react';
import {VideoPlayer} from '../../components/VideoPlayer';
import {DEMO_MOVIE,DEMO_EPISODES,unavailable} from '../../lib/streaming';
import {FEATURED_HERO} from '../../lib/catalog';
import {readProgress} from '../../lib/playback-storage';
export default function PlayerDemo(){
 const [mode,setMode]=useState(''),[saved,setSaved]=useState<ReturnType<typeof readProgress>>({});
 useEffect(()=>{setSaved(readProgress());const m=new URLSearchParams(location.search).get('watch');if(m)setMode(m);},[]);
 const open=(m:string)=>{setMode(m);history.replaceState(null,'',`?watch=${m}`);};
 const close=()=>{setMode('');history.replaceState(null,'',location.pathname);setSaved(readProgress());};
 const source=mode==='invalid'?{...DEMO_MOVIE,id:'invalid-demo',url:'/missing-video.mp4'}:mode==='unsupported'?{...DEMO_MOVIE,id:'unsupported-demo',format:'unsupported' as 'mp4'}:mode==='unavailable'?unavailable('unavailable-demo'):DEMO_MOVIE;
 return <main style={{padding:'8vh 6vw',minHeight:'100vh'}}><small style={{color:'#e50914'}}>STREAMFRAME · PLAYER DEMO</small><h1 style={{margin:'20px 0'}}>Watch the player in action</h1><p style={{maxWidth:650,lineHeight:1.7,color:'#bbb'}}>Authorized sample videos demonstrate movie and episode playback. These are not the films or shows pictured in the homepage catalog. Refresh while watching to return to the same demo.</p><div style={{display:'flex',gap:16,flexWrap:'wrap',margin:'32px 0'}}>{[['movie','Play movie demo'],['series','Play series demo'],['invalid','Test invalid source'],['unsupported','Test unsupported format'],['unavailable','Test unavailable video']].map(([m,label])=><button key={m} className="btn-billboard btn-mylist" onClick={()=>open(m)}>{label}</button>)}</div><h2>Continue watching</h2>{Object.values(saved).filter(p=>!p.completed&&p.position>=1&&p.id.startsWith('demo')).map(p=><p key={p.id} style={{margin:'16px 0'}}><button onClick={()=>{if(p.id!=='demo-flower')try{localStorage.setItem(`streamframe_episode_${FEATURED_HERO.id}`,p.id);}catch{}open(p.id==='demo-flower'?'movie':'series');}}>{p.id} · Resume at {Math.floor(p.position)} seconds</button></p>)}<p style={{marginTop:32}}><a href="/">Back to StreamFrame</a></p>{mode&&<VideoPlayer key={mode} item={{...FEATURED_HERO,title:mode==='series'?'StreamFrame Sample Series':'StreamFrame Sample Movie',type:mode==='series'?'series':'movie'}} source={source} episodes={mode==='series'?DEMO_EPISODES:[]} onClose={close}/>}</main>;
}
