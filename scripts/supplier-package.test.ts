import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { importSupplierPackage, type SupplierCatalog } from '../lib/importer/supplier-package.ts';
import { externalAndStagedStorage, validateVodPlaylist, validateWebVtt, type MediaStorage } from '../lib/importer/supplier-media.ts';
import { permitsPlayback, trustedCountry } from '../lib/package-rights.ts';
import { nextEpisodeIndex,progressKey,seekPosition,selectableTracks } from '../lib/playback-controls.ts';
import { persistProgress, readProgress } from '../lib/playback-storage.ts';
import { resolvePlayback } from '../lib/source-registry.ts';
import { mutateRegistry, readRegistryFile } from '../lib/registry-file.ts';

const origin='https://fixtures.example.invalid';
const digest='a'.repeat(64);
const evidence=`${origin}/synthetic-review`;
const review={evidenceUrl:evidence,playbackPassed:true,seekPassed:true,resumePassed:true,creditsVerified:true,hostControlsVerified:true,trackSelectionPassed:true};
const rights={licenseUrl:evidence,licenseName:'Synthetic test only',holder:'Fixture publisher',attribution:'Fixture credit',attributionUrl:evidence,
  distribution:'free-on-demand' as const,territories:['PK','IN'],startsAt:'2000-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',
  hostingEvidenceUrl:evidence,hostEnforcement:'dates-and-territories' as const};
const source=(id:string,format:'mp4'|'hls'='mp4')=>({id,format,url:`${origin}/${id}.${format==='hls'?'m3u8':'mp4'}`,review});
const audio=[{language:'en',label:'English'},{language:'ur',label:'Urdu'}];
const film={type:'movie',tmdbId:1,title:'Test Film',year:2025,durationSeconds:10800,artwork:{poster:`${origin}/poster.jpg`},sources:[
  {...source('film-hls','hls'),audio,
    subtitles:['en','hi','ur'].map(language=>({id:language,label:language,language,url:`${origin}/${digest}.vtt`,staged:{file:`${digest}.vtt`,sha256:digest}}))},
  source('film-mp4'),
]};
const episode=(season:number,number:number)=>({number,tmdbEpisodeId:100*season+number,title:`Episode ${season}.${number}`,
  year:2025,durationSeconds:2700,sources:[source(`s${season}e${number}`)]});
const series={type:'tv',tmdbId:1,title:'Test Series',year:2025,seasons:[
  {number:2,complete:true,episodes:[episode(2,1)]},{number:1,complete:true,episodes:[episode(1,2),episode(1,1)]},
]};
const manifest={version:1,supplierId:'fixtures',packageId:'local-qa',rights,titles:[film,series]};
const catalog:SupplierCatalog={
  title:async(type,id)=>({id,names:[type==='movie'?film.title:series.title],year:2025,durationMinutes:type==='movie'?180:undefined}),
  season:async(_,number)=>({hasNextSeason:number===1,episodes:(number===1?[1,2]:[1]).map(index=>{
    const item=episode(number,index);
    return {id:item.tmdbEpisodeId,names:[item.title],number:index,year:item.year,durationMinutes:45};
  })}),
};
const storage:MediaStorage={verifyVideo:async()=>{},readSubtitle:async()=> 'WEBVTT\n\n02:59:40.000 --> 02:59:50.000\nSynthetic subtitle cue.'};
const dependencies={catalog,storage,origins:new Set([origin])};
const signal=()=>AbortSignal.timeout(10000);

test('dry-run and atomic supplier import of a simulated three-hour film and two complete seasons',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-package-'));
  const path=join(dir,'sources.json');
  const feed={readPackage:async()=>manifest};
  try {
    const dry=await importSupplierPackage(path,feed,dependencies,false,signal());
    assert.deepEqual(dry,{sources:5,movies:1,episodes:3,series:1,publishedToRegistry:false});
    assert.deepEqual(await readRegistryFile(path),[]);
    await importSupplierPackage(path,feed,dependencies,true,signal());
    await assert.rejects(importSupplierPackage(path,feed,dependencies,true,signal()),/already registered/);
    const entries=await readRegistryFile(path);
    assert.equal(entries.length,5);
    assert.equal(resolvePlayback(entries,'movie',1).availability,'unavailable');
    assert.equal(resolvePlayback(entries,'tv',1,'US').availability,'unavailable');
    const movie=resolvePlayback(entries,'movie',1,'PK');
    assert.equal(movie.sources.length,2);
    assert.deepEqual(movie.sources[0].subtitles.map(track=>track.language),['en','hi','ur']);
    assert.equal(movie.sources[0].credit?.text,rights.attribution);
    assert.equal(movie.artwork?.poster,film.artwork.poster);
    assert.equal(progressKey(movie.sources[0]),progressKey(movie.sources[1]));
    const tv=resolvePlayback(entries,'tv',1,'IN');
    assert.deepEqual(tv.episodes.map(item=>[item.season,item.number]),[[1,1],[1,2],[2,1]]);
    assert.equal(nextEpisodeIndex(tv.episodes,1),2);
    assert.notEqual(progressKey(tv.episodes[0].source),progressKey(tv.episodes[1].source));
    await mutateRegistry(path,'disable',tv.episodes[1].source.id);
    assert.equal(nextEpisodeIndex(resolvePlayback(await readRegistryFile(path),'tv',1,'PK').episodes,0),-1);
    await assert.rejects(mutateRegistry(path,'update',movie.sources[0].id,{url:`${origin}/replacement.m3u8`}),/new approval/);
    assert.equal(resolvePlayback(entries,'tv',2,'PK').availability,'unavailable');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('bad identity, incomplete seasons, unreviewed files and failed media leave the registry empty',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-bad-package-'));
  const path=join(dir,'sources.json');
  const invalid=[
    {...manifest,titles:[{...film,year:2024}]},
    {...manifest,titles:[{...series,seasons:[{...series.seasons[1],episodes:[episode(1,1)]}]}]},
    {...manifest,titles:[{...series,seasons:[{number:1,complete:false,episodes:[{...episode(1,1),tmdbEpisodeId:201}]}]}]},
    {...manifest,titles:[{...film,sources:[{...source('film'),review:{...review,hostControlsVerified:false}}]}]},
    {...manifest,titles:[{...film,sources:[{...source('film'),url:'https://127.0.0.1/unknown.mp4'}]}]},
    {...manifest,titles:[{...film,sources:[source('one'),source('one')]}]},
  ];
  try {
    for (const value of invalid) await assert.rejects(importSupplierPackage(path,{readPackage:async()=>value},dependencies,true,signal()));
    await assert.rejects(importSupplierPackage(path,{readPackage:async()=>manifest},{...dependencies,storage:{...storage,
      verifyVideo:async()=>{throw new Error('Unavailable media fixture.');}}},true,signal()),/Unavailable media/);
    assert.deepEqual(await readRegistryFile(path),[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('availability fails closed across geography, rights windows, and future paid rights',()=>{
  const key='fixture-geolocation-shared-proof-for-testing';
  const header=new Headers({'x-streamframe-country':'PK'});
  assert.equal(trustedCountry(header,key),undefined);
  header.set('x-streamframe-geo-key',key);
  assert.equal(trustedCountry(header,key),'PK');
  assert.equal(trustedCountry(header,undefined),undefined);
  assert.equal(permitsPlayback(rights,'PK',Date.parse(rights.startsAt)),true);
  assert.equal(permitsPlayback(rights,'PK',Date.parse(rights.startsAt)-1),false);
  assert.equal(permitsPlayback(rights,'PK',Date.parse(rights.expiresAt)),false);
  assert.equal(permitsPlayback(rights,'GB'),false);
  assert.equal(permitsPlayback({...rights,hostEnforcement:'dates'},'PK'),false);
  assert.equal(permitsPlayback({...rights,distribution:'paid-on-demand'},'PK'),false);
});

test('staged HLS and WebVTT reads pin local bytes and reject traversal and modified files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-staged-assets-'));
  const assets=join(dir,'supplier-assets');
  try {
    await mkdir(assets);
    const stage=async (text:string,extension:string)=>{
      const sha256=createHash('sha256').update(text).digest('hex');
      const file=`${sha256}.${extension}`;
      await writeFile(join(assets,file),text);
      return {file,sha256};
    };
    const adapter=externalAndStagedStorage(dir);
    const playlist=await stage('#EXTM3U\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST','m3u8');
    await adapter.verifyVideo(`${origin}/master.m3u8`,'hls',5,playlist,signal());
    const text='WEBVTT\n\n00:00.000 --> 00:04.000\nहिन्दी';
    const subtitle=await stage(text,'vtt');
    validateWebVtt(await adapter.readSubtitle(subtitle,signal()),5);
    await assert.rejects(adapter.readSubtitle({...subtitle,file:`../${subtitle.file}`},signal()),/filename/);
    await writeFile(join(assets,subtitle.file),'modified');
    await assert.rejects(adapter.readSubtitle(subtitle,signal()),/hash mismatch/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('simulated 180-minute HLS VOD, late seek, persisted refresh resume, and licensed track selection',t=>{
  const playlist='#EXTM3U\n'+Array.from({length:1800},(_,index)=>`#EXTINF:6.0,\nsegment-${index}.ts`).join('\n')+'\n#EXT-X-ENDLIST';
  validateVodPlaylist(playlist,10800);
  assert.throws(()=>validateVodPlaylist(playlist,10780),/duration/);
  assert.throws(()=>validateVodPlaylist(playlist.replace('#EXT-X-ENDLIST',''),10800),/complete/);
  assert.throws(()=>validateVodPlaylist(playlist.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128'),10800),/Encrypted/);
  assert.equal(seekPosition(10610,10800),10610);
  assert.equal(seekPosition(15000,10800),10799.95);
  assert.equal(seekPosition(100,Infinity),undefined);
  const storageMap=new Map<string,string>();
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storageMap.get(key),setItem:(key:string,value:string)=>storageMap.set(key,value)}});
  t.after(()=>{ if (original) Object.defineProperty(globalThis,'localStorage',original); else Reflect.deleteProperty(globalThis,'localStorage'); });
  persistProgress('movie:1',10610,10800);
  persistProgress('tv:1:season:1:episode:2',450,2700);
  assert.equal(readProgress()['movie:1'].position,10610);
  assert.equal(readProgress()['movie:1'].completed,false);
  assert.equal(readProgress()['tv:1:season:1:episode:2'].position,450);
  persistProgress('movie:1',10800,10800,true);
  assert.equal(readProgress()['movie:1'].completed,true);
  validateWebVtt('WEBVTT\n\n02:58:01.000 --> 02:58:10.000\nمتن',10800);
  assert.throws(()=>validateWebVtt('WEBVTT\n\n02:58:01.000 --> 03:00:01.000\nCaption',10800),/out-of-range/);
  assert.deepEqual(selectableTracks([{name:'Original',lang:'en'},{name:'Unknown',lang:'de'},{name:'Urdu',lang:'ur'}],audio),
    [{id:0,name:'English'},{id:2,name:'Urdu'}]);
});
