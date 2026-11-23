import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {deliver,objectOrigin} from '../lib/media-delivery.ts';
import {serveMedia,type MediaOrigin} from '../lib/delivery/gateway.ts';
import {stageEdition} from '../lib/delivery/storage.ts';
import type {RegistrySource} from '../lib/registry-schema.ts';
const config={origin:'https://edge.example.invalid',secret:randomBytes(32).toString('hex')};
const group='1'.repeat(64),base=objectOrigin+'/'+group+'/';
const entry={id:'fixture',enabled:true,target:{namespace:'tmdb',type:'movie',tmdbId:42},url:base+'main.m3u8',format:'hls',
  subtitles:[{id:'en',label:'English',language:'en',url:base+'en.vtt'}],
  supplierRelease:{audio:[],durationSeconds:12600,rights:{startsAt:'2020-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',
    distribution:'free-on-demand',territories:['PK'],hostEnforcement:'dates-and-territories'}}} as unknown as RegistrySource;
const site='https://app.example.invalid';
test('rights, geography, disabled and missing origins gate grant issuance',()=>{
  assert.equal(deliver(entry,'US',config),undefined);
  assert.equal(deliver({...entry,enabled:false},'PK',config),undefined);
  assert.equal(deliver(entry,'PK',{}),undefined);
  const expired=structuredClone(entry);expired.supplierRelease!.rights.expiresAt=new Date(0).toISOString();
  assert.equal(deliver(expired,'PK',config),undefined);
  const wrong=structuredClone(entry);wrong.subtitles![0].url='https://elsewhere.invalid/en.vtt';
  assert.equal(deliver(wrong,'PK',config),undefined);
  assert.ok(deliver({...entry,target:{namespace:'tmdb',type:'episode',tmdbId:42,season:2,episode:1}},'PK',config));
});
test('gateway authorizes every HLS child, caption, audio and byte-range request',async t=>{
  const movieEntry={...entry,format:'mp4' as const,url:base+'feature.mp4'};
  const granted=deliver(entry,'PK',config)!;
  const keys:string[]=[];
  const origin:MediaOrigin={async read(key,range){keys.push(key);return {body:null,length:4,type:'video/mp4',contentRange:range?'bytes 8-11/12':undefined};}};
  assert.equal(new URL(granted.url).origin,config.origin);
  const get=(url:string,country='PK',revoked=false,headers?:HeadersInit)=>serveMedia(new Request(url,{headers}),config,origin,site,country,async()=>revoked?undefined:url.endsWith('feature.mp4')?movieEntry:entry);
  for(const name of ['main.m3u8','high.m3u8','seg.ts','audio.aac','en.vtt']){
    assert.equal((await get(new URL(name,granted.url).href)).status,200);
    assert.equal(keys.at(-1),group+'/'+name);
  }
  assert.equal(granted.subtitles![0].url,new URL('en.vtt',granted.url).href);
  const movie=deliver({...entry,format:'mp4',url:base+'feature.mp4'},'PK',config)!;
  const part=await get(movie.url,'PK',false,{Range:'bytes=8-11'});
  assert.equal(part.status,206);assert.equal(part.headers.get('Content-Range'),'bytes 8-11/12');
  assert.equal((await get(movie.url,'PK',false,{Range:'invalid'})).status,416);
  assert.equal((await get(movie.url,'US')).status,403);assert.equal((await get(movie.url,'PK',true)).status,403);
  assert.equal((await get(movie.url.replace('/'+group+'/', '/'+'2'.repeat(64)+'/'))).status,403);
  assert.equal((await serveMedia(new Request(movie.url),config,{read:async()=>{throw Error();}},site,'PK',async()=>({...entry,format:'mp4',url:base+'feature.mp4'}))).status,503);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+14000*1000});assert.equal((await get(movie.url)).status,403);
});
test('immutable package plan covers adaptive video, audio and captions and resumes interrupted staging',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sf-edition-'));
  try {
    const media=(segment:string)=>'#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n'+segment+'\n#EXT-X-ENDLIST\n';
    const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="a"\nhigh.m3u8\n';
    for(const [name,bytes] of Object.entries({'main.m3u8':master,'audio.m3u8':media('audio.aac'),'high.m3u8':media('seg.ts'),'seg.ts':Buffer.concat([Buffer.from([0x47]),Buffer.alloc(187)]),'audio.aac':Buffer.from([0xff,0xf1,0x50,0x80,0,0xff,0xfc]),'en.vtt':'WEBVTT\n\n00:00.000 --> 00:04.000\nCaption'})) await writeFile(join(dir,name),bytes);
    const stored=new Set<string>();let interrupt=true;
    const store={matches:async(k:string)=>stored.has(k),put:async(k:string)=>{if(interrupt&&stored.size===2) throw Error('interrupted');stored.add(k);}};
    const run=()=>stageEdition(store,dir,'main.m3u8',6,['en.vtt']);
    await assert.rejects(run(),/interrupted/);interrupt=false;const plan=await run();await run();
    assert.equal(stored.size,6);assert.equal(plan.assets.length,6);
    for(const ref of ['../bad.ts','missing.ts','https://external.invalid/video.ts']){
      await writeFile(join(dir,'high.m3u8'),media(ref));await assert.rejects(run(),/reference/);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
import {s3Origin} from '../lib/delivery/storage.ts';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {resolvePlayback} from '../lib/source-registry.ts';

test('playback API projection issues usable grants for each licensed source and episode',t=>{
  t.after(()=>{for(const [key,value] of saved) if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const saved=new Map(['STREAMFRAME_DELIVERY_ORIGIN','STREAMFRAME_DELIVERY_KEY'].map(key=>[key,process.env[key]]));
  process.env.STREAMFRAME_DELIVERY_ORIGIN=config.origin;process.env.STREAMFRAME_DELIVERY_KEY=config.secret;
  const episodes=[1,2].map(season=>({...entry,id:'episode-'+season,target:{namespace:'tmdb' as const,type:'episode' as const,season,episode:1,tmdbId:42}}));
  const catalog=[entry,{...entry,id:'alternative'},...episodes];
  const movies=resolvePlayback(catalog,'movie',42,'PK');
  assert.equal(movies.sources.length,2);
  assert.equal(resolvePlayback(catalog,'movie',43,'PK').sources.length,0);
  const tv=resolvePlayback(catalog,'tv',42,'PK');
  assert.deepEqual(tv.episodes.map(e=>e.source.progressId),['tv:42:season:1:episode:1','tv:42:season:2:episode:1']);
  assert.equal(JSON.stringify([movies,tv]).includes(objectOrigin),false);
});

test('gateway forwards exact MP4 range to the private S3 origin and returns those bytes',async t=>{
  const client=new S3Client({region:'us-east-1'});t.after(()=>client.destroy());
  const bytes=Uint8Array.from([0,1,2,3,4,5,6,7,8,9]);
  // An SDK stub models private origin behavior without network credentials.
  t.mock.method(client,'send',async(command:GetObjectCommand)=>{
    assert.ok(command instanceof GetObjectCommand);
    assert.equal(command.input.Key,group+'/feature.mp4');assert.equal(command.input.Bucket,'private-fixture');
    assert.equal(command.input.Range,'bytes=4-6');
    return {ContentLength:3,ContentRange:'bytes 4-6/10',ContentType:'video/mp4',Body:{transformToWebStream:()=>new Blob([bytes.slice(4,7)]).stream()}};
  });
  const movie=deliver({...entry,format:'mp4',url:base+'feature.mp4'},'PK',config)!;
  const response=await serveMedia(new Request(movie.url,{headers:{Range:'bytes=4-6',Origin:site}}),config,s3Origin(client,'private-fixture'),site,'PK',async()=>({...entry,format:'mp4',url:base+'feature.mp4'}));
  assert.equal(response.status,206);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[4,5,6]);
});

test('untrusted, expired or stale edition grants never reach the media origin',async()=>{
  const granted=deliver(entry,'PK',config)!;
  const untrusted=deliver(entry,'PK',{...config,secret:randomBytes(32).toString('hex')})!;
  let reads=0;
  const storage:MediaOrigin={async read(){reads++;return {length:0,type:'video/mp2t',body:null};}};
  const request=(url:string,row:RegistrySource|undefined,country:string|undefined,headers?:HeadersInit)=>
    serveMedia(new Request(url,{headers}),config,storage,site,country,async()=>row);
  for(const url of [untrusted.url,new URL('seg.ts',untrusted.url).href,base+'feature.mp4'])
    assert.equal((await request(url,entry,'PK',{Range:'bytes=0-3'})).status,403);
  for(const current of [undefined,{...entry,enabled:false},{...entry,id:'different'},
    {...entry,target:{namespace:'tmdb',type:'movie',tmdbId:43}} as RegistrySource,
    {...entry,updatedAt:new Date().toISOString()}, {...entry,url:base+'other.m3u8'}])
    assert.equal((await request(granted.url,current,'PK')).status,403);
  const expired=structuredClone(entry);
  expired.supplierRelease!.rights.expiresAt=new Date(0).toISOString();
  assert.equal((await request(granted.url,expired,'PK')).status,403);
  for(const country of [undefined,'XX','US'])
    assert.equal((await request(granted.url,entry,country)).status,403);
  assert.equal((await request(granted.url,entry,'PK',{Origin:'https://other.invalid'})).status,403);
  assert.equal(reads,0);
  // Anonymous bearers in the same approved territory can reuse a current grant.
  for(let i=0;i<2;i++) assert.equal((await request(granted.url,entry,'PK')).status,200);
  assert.equal(reads,2);
});
