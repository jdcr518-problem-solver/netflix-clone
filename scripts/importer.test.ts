import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMedia } from '../lib/importer/media.ts';
import { checkOwnedMedia } from '../lib/importer/owned-media.ts';
import { rightsSnapshot, reviewedProductionPolicy, approvedMediaUrl, evaluatePolicy, parseConfig, type Edition, type ImportConfig } from '../lib/importer/policy.ts';
import { readImportState, synchronize, uniqueMatch } from '../lib/importer/sync.ts';
import { discoverImportPage } from '../lib/providers/index.ts';
import { isReleaseMovie, validateRegistry } from '../lib/registry-schema.ts';
import type { FilmCandidate } from '../lib/providers/blender';

const url='https://download.blender.org/demo/movies/fixture.mp4';
const origin='https://player.example.invalid';
const documentary='https://example.invalid/synthetic-evidence';
const edition:Edition={candidateId:'fixture',url,format:'mp4',tmdbId:42,title:'Fixture Film',year:2020,director:'Fixture Director',durationSeconds:120,
  creditsVerified:true,browserPlaybackEvidenceUrl:documentary,modificationNotice:'Test fixture'};
const config:ImportConfig={version:1,minimumIntervalMinutes:60,pageSize:1,
  discovery:[{provider:'blender',collection:'blender-open-movies'}],
  policies:[{id:'fixture-only',action:'preauthorize',provider:'blender',collection:'blender-open-movies',
    publisher:'Fixture Owner',evidenceUrl:documentary,hostingEvidenceUrl:documentary,licenseName:'Fixture license',licenseUrl:documentary,
    hostingNotes:'Fixture hosting grant',permittedUse:'Synthetic QA only',restrictions:'Synthetic QA only',attribution:'Fixture attribution',
    distribution:'public-browser-direct',playbackOrigin:origin,validUntil:'2099-01-01T00:00:00.000Z',editions:[edition]}]};
const candidate:FilmCandidate={provider:'blender',id:'fixture',title:'Fixture Film',year:2020,owner:'Fixture Owner',director:'Fixture Director',
  collections:['blender-open-movies'],description:'Synthetic',originalPage:'https://download.blender.org/demo/movies/',
  files:[{name:'fixture.mp4',url,format:'mp4'}],subtitles:[],subtitleNotes:[],playbackNote:''};
const match={id:42,title:'Translated title',original_title:candidate.title,release_date:'2020-02-01',director:'Fixture Director',runtime:2};

test('Blender discovery is paginated and Archive claims do not authorize imports',async()=>{
  const signal=AbortSignal.timeout(2000);
  const page1=await discoverImportPage('blender','blender-open-movies',1,2,signal);
  const page2=await discoverImportPage('blender','blender-open-movies',2,2,signal);
  assert.equal(page1.ids.length,2);
  assert.equal(page1.hasMore,true);
  assert.equal(page2.ids.length,1);
  assert.equal(page2.hasMore,false);
  assert.equal(evaluatePolicy(config,{...candidate,provider:'archive',licenseClaim:'CC BY'}).status,'pending');
  assert.equal(evaluatePolicy(config,{...candidate,owner:'Other uploader'}).status,'pending');
  assert.equal(evaluatePolicy(config,{...candidate,files:[{name:'other.mp4',url:url.replace('fixture','other'),format:'mp4'}]}).status,'pending');
  assert.equal(evaluatePolicy({...config,policies:[...config.policies,{id:'deny',action:'deny',provider:'blender',collection:'blender-open-movies',publisher:'*'}]},candidate).status,'rejected');
  assert.equal(evaluatePolicy({...config,policies:[{...config.policies[0],validUntil:'2000-01-01T00:00:00.000Z'}]},candidate).status,'pending');
  assert.throws(()=>parseConfig({...config,policies:[{...config.policies[0],hostingEvidenceUrl:undefined}]}));
  assert.throws(()=>parseConfig({...config,policies:[{...config.policies[0],editions:[{...edition,url:'https://archive.org.evil.invalid/fixture.mp4'}]}]}));
});

test('TMDB requires one exact title, year, director, runtime and pinned ID',()=>{
  assert.equal(uniqueMatch(candidate,edition,[match])?.id,42);
  assert.equal(uniqueMatch(candidate,edition,[match,{...match,id:43}]),undefined);
  assert.equal(uniqueMatch(candidate,edition,[{...match,id:43}]),undefined);
  assert.equal(uniqueMatch(candidate,edition,[{...match,director:'Another director'}]),undefined);
  assert.equal(uniqueMatch(candidate,edition,[{...match,runtime:20}]),undefined);
});

test('TMDB unavailability records a retryable import error without publishing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sf-metadata-outage-'));
  try {
    let mediaChecks=0;
    const result=await synchronize(directory,config,{
      discover:async()=>({ids:[candidate.id],hasMore:false}),
      get:async()=>candidate,
      matches:async()=>{throw new Error('Catalog is temporarily unavailable.');},
      check:async()=>{mediaChecks++;throw new Error('Unexpected media check');},
    },'now');
    assert.equal(result.state.history[0].status,'partial');
    assert.equal(result.state.candidates[0].status,'import-error');
    assert.equal(result.state.history[0].published,0);
    assert.equal(mediaChecks,0);
    await assert.rejects(readFile(join(directory,'sources.local.json')),{code:'ENOENT'});
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('HLS compatibility probes check timing, CORS and only scoped segments',async()=>{
  const hls={...edition,url:'https://test-streams.mux.dev/fixture/film.m3u8',format:'hls' as const};
  const segment=new Uint8Array(1024);segment[0]=0x47;segment[188]=0x47;
  const calls:string[]=[];
  const fetcher:typeof fetch=async (input,init)=>{
    calls.push(String(input));
    assert.equal(init?.redirect,'error');
    if(String(input).endsWith('.m3u8')) return new Response('#EXTM3U\n#EXTINF:40,\na.ts\n#EXTINF:40,\nb.ts\n#EXTINF:40,\nc.ts\n#EXT-X-ENDLIST\n',
      {headers:{'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*'}});
    return new Response(segment,{status:206,headers:{'Content-Type':'video/mp2t','Access-Control-Allow-Origin':'*','Content-Range':'bytes 0-1023/40000'}});
  };
  assert.equal((await checkMedia(hls,origin,AbortSignal.timeout(3000),fetcher)).duration,120);
  assert.equal(calls.length,4);
  assert.equal(approvedMediaUrl('https://127.0.0.1/film.mp4'),false);
  const unsafe:typeof fetch=async()=>new Response('#EXTM3U\n#EXTINF:120,\nhttps://evil.invalid/test.ts\n#EXT-X-ENDLIST',
    {headers:{'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*'}});
  await assert.rejects(checkMedia(hls,origin,AbortSignal.timeout(2000),unsafe),/outside/);
  const wrongRange:typeof fetch=async(input,init)=>String(input).endsWith('.m3u8') ? fetcher(input,init) : new Response(segment);
  await assert.rejects(checkMedia(hls,origin,AbortSignal.timeout(2000),wrongRange),/unsupported redirect\/range/);
  await assert.rejects(checkMedia({...hls,durationSeconds:600},origin,AbortSignal.timeout(2000),fetcher),/duration/);
});

function mp4Fixture(padding=0) {
  const box=(tag:string,body:Buffer)=>{
    const header=Buffer.alloc(8);header.writeUInt32BE(body.length+8);header.write(tag,4);return Buffer.concat([header,body]);
  };
  const mvhd=Buffer.alloc(24);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(120000,16);
  return Buffer.concat([box('ftyp',Buffer.from('isom')),box('moov',Buffer.concat([
    box('mvhd',mvhd),box('free',Buffer.concat([Buffer.from('avc1'),Buffer.alloc(padding)])),
  ]))]);
}

test('MP4 probes require correct byte ranges and discover duration from mvhd',async()=>{
  const mp4=mp4Fixture();
  let requested=0;
  const fetcher:typeof fetch=async (_url,init)=>{
    requested++;
    assert.match(new Headers(init?.headers).get('range')!,/^bytes=0-/);
    return new Response(new Uint8Array(mp4),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':`bytes 0-${mp4.length-1}/${mp4.length}`}});
  };
  const result=await checkMedia(edition,origin,AbortSignal.timeout(2000),fetcher);
  assert.equal(result.duration,120); assert.equal(requested,2);
});

test('owned MP4 approval pins the publisher master, static origin and staged bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-owned-fixture-'));
  try {
    const mp4=mp4Fixture(300_000);
    const hash=createHash('sha256').update(mp4).digest('hex');
    const name=`fixture-${hash}.mp4`;
    const path=join(dir,'owned-media',name);
    const owned={...edition,url:`${origin}/streamframe-media/${name}`,ownedMasterUrl:url,mediaSha256:hash};
    const rule={...config.policies[0],distribution:'owned-same-origin' as const,editions:[owned]};
    const valid=parseConfig({...config,policies:[rule]});
    const publisherCandidate={...candidate,files:[],publisherEditions:[{name:'Fixture master',url,format:'MP4',bytes:mp4.length}]};
    assert.equal(evaluatePolicy(valid,candidate).status,'pending');
    assert.equal(evaluatePolicy(valid,publisherCandidate).status,'eligible');
    assert.throws(()=>parseConfig({...config,policies:[{...rule,provider:'archive'}]}));
    assert.throws(()=>parseConfig({...config,policies:[{...rule,editions:[{...owned,url:owned.url.replace(origin,'https://other.invalid')}]}]}));
    assert.throws(()=>parseConfig({...config,policies:[{...rule,editions:[{...owned,url:`${origin}/streamframe-media/../${name}`}]}]}));
    await mkdir(join(dir,'owned-media'));
    await assert.rejects(checkOwnedMedia(dir,owned,origin,AbortSignal.timeout(2000)),{code:'ENOENT'});
    await writeFile(path,'changed synthetic media bytes');
    await assert.rejects(checkOwnedMedia(dir,owned,origin,AbortSignal.timeout(2000)),/SHA-256/);
    await writeFile(path,mp4);
    const run=await synchronize(dir,valid,{
      discover:async()=>({ids:['fixture'],hasMore:false}),
      get:async()=>publisherCandidate,
      matches:async()=>[match],
      check:(selected,playbackOrigin,signal)=>checkOwnedMedia(dir,selected,playbackOrigin,signal),
    },'now');
    assert.equal(run.state.history[0].published,1);
    const registry=JSON.parse(await readFile(join(dir,'sources.local.json'),'utf8'));
    assert.equal(validateRegistry(registry,'tmdb').filter(isReleaseMovie).length,1);
    assert.equal(registry.sources[0].provenance.releaseReview.automation.mediaSha256,hash);
    assert.equal(registry.sources[0].provenance.releaseReview.automation.publisherMasterUrl,url);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('isolated sync publishes exactly once, checkpoints, skips until due and recovers interruption', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-import-'));
  try{
    const pages:number[]=[];
    let checks=0;
    const deps={
      discover:async (_scope:unknown,page:number)=>{pages.push(page);return {ids:[page===1?'fixture':'other'],hasMore:page===1};},
      get:async (_provider:unknown,id:string)=>({...candidate,id}),
      matches:async()=>[match],
      check:async()=>{checks++;return {duration:120,summary:'Synthetic media QA'};},
    };
    const one=await synchronize(dir,config,deps,'now');
    assert.equal(one.state.history[0].published,1);
    const raw=JSON.parse(await readFile(join(dir,'sources.local.json'),'utf8'));
    assert.equal(validateRegistry(raw,'tmdb').filter(isReleaseMovie).length,1);
    assert.equal(raw.sources[0].provenance.releaseReview.automation.policyId,'fixture-only');
    assert.equal((await synchronize(dir,config,deps,'due')).skipped,true);
    const checkpoint=join(dir,'import-state.local.json');
    const state=await readImportState(checkpoint);
    state.history[0].status='running';
    // Simulates the registry write winning just before an interrupted checkpoint write.
    state.cursors['blender:blender-open-movies']={page:1,offset:0};
    state.candidates=[];
    await writeFile(checkpoint,JSON.stringify(state));
    const recovered=await synchronize(dir,config,deps,'now');
    assert.equal(recovered.state.history[1].status,'interrupted');
    assert.equal(recovered.state.history[0].published,0);
    assert.equal(recovered.state.candidates[0].status,'already-registered');
    const next=await synchronize(dir,config,deps,'now');
    assert.equal(next.state.history[0].pending,1);
    assert.deepEqual(pages,[1,1,2]);
    assert.equal(checks,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('provider errors retry once and preserve the page; playback failure leaves the registry empty',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'streamframe-import-fail-'));
  try{
    let calls=0;
    const deps={discover:async()=>{calls++;throw new Error('upstream failed');},get:async()=>candidate,matches:async()=>[match],
      check:async()=>{throw new Error('media unavailable');}};
    const partial=await synchronize(dir,config,deps,'now');
    assert.equal(calls,2);
    assert.equal(partial.state.history[0].status,'partial');
    assert.equal(partial.state.history[0].errors,1);
    const result=await synchronize(dir,config,{...deps,discover:async(_scope,page)=>{assert.equal(page,1); return {ids:['fixture'],hasMore:false};}},'now');
    assert.equal(result.state.history[0].playbackFailed,1);
    await assert.rejects(readFile(join(dir,'sources.local.json')), {code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('production publication pins both policy bytes and observed publisher rights',()=>{
  const approved=structuredClone(config);
  approved.policies[0].editions![0].rightsSnapshot=rightsSnapshot(candidate);
  const bytes=Buffer.from(JSON.stringify(approved));
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.throws(()=>reviewedProductionPolicy(Buffer.from(JSON.stringify(config)),digest));
  const unpinned=Buffer.from(JSON.stringify(config));
  assert.throws(()=>reviewedProductionPolicy(unpinned,createHash('sha256').update(unpinned).digest('hex')));
  const policy=reviewedProductionPolicy(bytes,digest);
  assert.equal(evaluatePolicy(policy,candidate).status,'eligible');
  assert.equal(evaluatePolicy(policy,{...candidate,licenseClaim:'Revised distribution terms'}).status,'pending');
});
