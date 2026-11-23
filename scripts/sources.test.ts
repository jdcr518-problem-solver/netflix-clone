import { exactFilmMatch } from '../lib/providers/matching.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { episodeSources, isReleaseMovie, movieSources, validateRegistry } from '../lib/registry-schema.ts';

const date = '2026-11-22T00:00:00.000Z';
const make = (id: string, options = {}) => ({
  id, target:{namespace:'tmdb',type:'movie',tmdbId:42}, enabled:true, rightsReference:'Test fixture only',
  url:'https://media.example.invalid/test.mp4',format:'mp4',createdAt:date,updatedAt:date,...options,
});
const parse = (...sources: unknown[]) => validateRegistry({version:1,sources}, 'tmdb');

test('movie and episode namespaces, multiple sources, disabled and missing sources', () => {
  const entries = parse(make('main'), make('alternate'), make('inactive',{enabled:false}),
    make('episode',{target:{namespace:'tmdb',type:'episode',tmdbId:42,season:0,episode:1}}));
  assert.deepEqual(movieSources(entries,42).map(source => source.id), ['main','alternate']);
  assert.deepEqual(episodeSources(entries,42,0,1).map(source => source.id), ['episode']);
  assert.deepEqual(episodeSources(entries,42,1,1), []);
  assert.deepEqual(movieSources(entries,43), []);
  assert.equal('rightsReference' in movieSources(entries,42)[0], false);
});

test('rejects duplicate IDs, malformed entries, inconsistent formats and unsafe URLs', () => {
  assert.throws(() => parse(make('main'), make('main')), /duplicate/);
  assert.throws(() => parse(null));
  assert.throws(() => validateRegistry({version:2,sources:[]}, 'tmdb'));
  for (const url of ['http://example.invalid/a.mp4', 'file:///a.mp4', 'javascript:alert(1)', '//example.invalid/a.mp4',
    'https://user:password@example.invalid/a.mp4', 'https://example.invalid/a.mp4?token=secret',
    'https://example.invalid/a.mp4#fragment', 'https://example.invalid/a/../a.mp4', 'https://example.invalid/%2e%2e/a.mp4',
    'https://example.invalid/a.m3u8']) assert.throws(() => parse(make('main',{url})), /video URL/);
  assert.throws(() => parse(make('main',{subtitles:[{id:'en',language:'en',label:'English',url:'/subtitles/../secret.vtt'}]})), /subtitle/);
});

test('CLI operations persist across processes and protect malformed data', () => {
  const root = mkdtempSync(join(tmpdir(), 'streamframe-registry-'));
  try {
    for (const directory of ['scripts','lib','data']) mkdirSync(join(root,directory));
    for (const file of ['scripts/sources.ts','lib/registry-schema.ts','lib/registry-file.ts','lib/package-rights.ts']) copyFileSync(file,join(root,file));
    const path = join(root,'data','sources.local.json');
    const input = join(root,'input.json');
    const {createdAt,updatedAt,...raw} = make('main');
    writeFileSync(input,JSON.stringify(raw));
    const args = ['--experimental-strip-types',join(root,'scripts','sources.ts')];
    const run = (...command: string[]) => execFileSync(process.execPath,[...args,...command],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'development'}});
    const fail = (...command: string[]) => spawnSync(process.execPath,[...args,...command],{encoding:'utf8',env:{...process.env,NODE_ENV:'development'}});
    run('add',input);
    assert.match(run('validate'), /1 sources/);
    assert.match(fail('add',input).stderr, /duplicate/);
    run('disable','main');
    assert.equal(JSON.parse(run('list'))[0].enabled,false);
    run('enable','main');
    writeFileSync(input,JSON.stringify({label:'Updated'}));
    run('update','main',input);
    assert.equal(JSON.parse(run('list'))[0].label,'Updated');
    assert.equal(JSON.parse(run('list'))[0].enabled,true);
    const production = spawnSync(process.execPath,[...args,'remove','main'],{encoding:'utf8',env:{...process.env,NODE_ENV:'production'}});
    assert.match(production.stderr,/disabled in production/);
    run('remove','main');
    assert.deepEqual(JSON.parse(run('list')),[]);
    writeFileSync(path,'{bad json');
    assert.match(fail('validate').stderr,/could not be read as JSON/);
    assert.match(fail('add',input).stderr,/could not be read as JSON/);
    assert.equal(readFileSync(path,'utf8'),'{bad json');
  } finally { rmSync(root,{recursive:true,force:true}); }
});


test('film matching requires exact title and release year and checks known director', () => {
  const candidate = {title:'Big Buck Bunny',year:2008,director:'Sacha Goedegebure'};
  const film = {id:10378,title:'Big Buck Bunny',release_date:'2008-04-10',director:'Sacha Goedegebure'};
  assert.equal(exactFilmMatch(candidate,film),true);
  assert.equal(exactFilmMatch(candidate,{...film,title:'Big Buck Bunny Trailer'}),false);
  assert.equal(exactFilmMatch(candidate,{...film,release_date:'2020-01-01'}),false);
  assert.equal(exactFilmMatch(candidate,{...film,director:'Different director'}),false);
  assert.equal(exactFilmMatch({...candidate,year:undefined},film),false);
});

test('provider sources require complete approved evidence and expose only their public credit', () => {
  const provenance = {provider:'blender',candidateId:'fixture',originalPage:'https://example.invalid/film',
    evidenceUrl:'https://example.invalid/license',owner:'Fixture owner',permittedUse:'Playback test',
    attribution:'Fixture credit',commercialRestrictions:'None for fixture',verifiedAt:date,status:'approved'};
  const entries = parse(make('provider',{provenance}));
  const source = movieSources(entries,42)[0];
  assert.equal(source.credit?.text,'Fixture credit');
  assert.equal('provenance' in source,false);
  assert.throws(() => parse(make('provider',{provenance:{...provenance,status:'unverified'}})),/approval evidence/);
  assert.throws(() => parse(make('provider',{provenance:{...provenance,evidenceUrl:'javascript:alert(1)'}})),/approval evidence/);
});


test('Watch Now releases only individually approved and enabled movie editions', () => {
  const provenance = {provider:'blender',candidateId:'fixture',originalPage:'https://example.invalid/film',
    evidenceUrl:'https://example.invalid/evidence',owner:'Fixture owner',permittedUse:'Fixture playback',
    attribution:'Fixture credit',commercialRestrictions:'Fixture permission',verifiedAt:date,status:'approved'};
  const releaseReview = {licenseName:'Fixture license',licenseUrl:'https://example.invalid/license',
    hostingEvidenceUrl:'https://example.invalid/hosting',hostingNotes:'Fixture host permission',
    playbackNotes:'Fixture seek passed',modificationNotice:'No modifications',creditsVerified:true,playbackPassed:true};
  const approved = {...provenance,releaseReview};
  const sources = parse(make('manual'), make('legacy',{provenance}),
    make('edition-a',{provenance:approved}),make('edition-b',{provenance:approved,enabled:false}));
  assert.deepEqual(sources.filter(isReleaseMovie).map(entry=>entry.id),['edition-a']);
  assert.equal(movieSources(sources.filter(isReleaseMovie),42)[0].credit?.licenseName,'Fixture license');
  assert.throws(()=>parse(make('incomplete',{provenance:{...provenance,releaseReview:{...releaseReview,creditsVerified:false}}})),/approval evidence/);
  assert.throws(()=>parse(make('missing-host',{provenance:{...provenance,releaseReview:{...releaseReview,hostingEvidenceUrl:''}}})),/approval evidence/);
});
