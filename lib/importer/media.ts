import { approvedMediaUrl } from './policy.ts';
import type { Edition } from './policy.ts';

export interface CheckResult { duration:number; summary:string }
const LIMIT = 262144;
type Fetcher = typeof fetch;

async function readBounded(response:Response,limit:number) {
  if (!response.body) throw new Error('Media returned no body.');
  const reader = response.body.getReader();
  const output = new Uint8Array(limit);
  let used = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return output.subarray(0,used);
      if (value.byteLength > limit-used) throw new Error('Media exceeded the probe byte limit.');
      output.set(value,used);
      used += value.byteLength;
    }
  } finally { await reader.cancel().catch(()=>{}); }
}

async function probe(fetcher:Fetcher,url:string,origin:string,signal:AbortSignal,range?:string,limit=LIMIT) {
  if (!approvedMediaUrl(url)) throw new Error('Media target failed the fixed host/path allowlist.');
  const headers:Record<string,string> = {Origin:origin,'Accept-Encoding':'identity'};
  if (range) headers.Range=range;
  const response = await fetcher(url,{redirect:'error',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),cache:'no-store'});
  if (response.redirected || !response.ok || (range && response.status !== 206)) {
    await response.body?.cancel().catch(()=>{});
    throw new Error(`Media probe received HTTP ${response.status} or an unsupported redirect/range response.`);
  }
  const body = await readBounded(response,limit);
  return {header:response.headers,body};
}

const ascii = new TextDecoder();
const typeAt = (bytes:Uint8Array,offset:number) => ascii.decode(bytes.subarray(offset,offset+4));
function mp4Duration(bytes:Uint8Array) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  // A tail range can start inside mdat. Accept only a complete, internally valid moov box.
  for (let offset=4;offset+12<bytes.length;offset++) {
    if (bytes[offset]!==109 || typeAt(bytes,offset)!=='moov') continue;
    const size = view.getUint32(offset-4);
    const end = offset-4+size;
    if (size<16 || end>bytes.length) continue;
    for(let at=offset+4;at+8<=end;) {
      const length=view.getUint32(at);
      if(length<8 || at+length>end) break;
      if(typeAt(bytes,at+4)==='mvhd') {
        const payload=at+8;
        const version=bytes[payload];
        const width=version===1?8:4;
        const scaleOffset=payload+(version===1?20:12);
        if((version!==0 && version!==1)|| scaleOffset+4+width>at+length) break;
        const timescale=view.getUint32(scaleOffset);
        const ticks=width===8?Number(view.getBigUint64(scaleOffset+4)):view.getUint32(scaleOffset+4);
        const codecs=ascii.decode(bytes.subarray(offset,end));
        if (!codecs.includes('avc1')) throw new Error('MP4 lacks a supported AVC video sample entry.');
        if (/(?:hvc1|hev1|av01|vp09|encv|enca|pssh)/.test(codecs)) throw new Error('MP4 uses unsupported or encrypted tracks.');
        return ticks/timescale;
      }
      at+=length;
    }
  }
  return undefined;
}

const cors = (headers:Headers,origin:string) => ['*',origin].includes(headers.get('access-control-allow-origin') ?? '');
function parseRange(headers:Headers) {
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('content-range') ?? '');
  if (!match) throw new Error('Missing or invalid media byte range.');
  const [,start,end,total]=match.map(Number);
  if (!Number.isSafeInteger(total) || end>=total || start>end) throw new Error('Inconsistent media byte range.');
  return {start,end,total};
}
async function checkMp4(fetcher:Fetcher,url:string,origin:string,signal:AbortSignal,requiresCors:boolean) {
  const head=await probe(fetcher,url,origin,signal,`bytes=0-${LIMIT-1}`);
  if (!/^video\/mp4(?:;|$)/i.test(head.header.get('content-type') ?? '') || typeAt(head.body,4)!=='ftyp')
    throw new Error('The response is not a compatible MP4 file.');
  const range=parseRange(head.header);
  if (range.start!==0 || range.end!==Math.min(range.total-1,LIMIT-1) || head.body.length!==range.end+1)
    throw new Error('Invalid MP4 start range.');
  const tailStart=Math.max(0,range.total-LIMIT);
  const tail=await probe(fetcher,url,origin,signal,`bytes=${tailStart}-${range.total-1}`);
  const tailRange=parseRange(tail.header);
  if (tailRange.start!==tailStart || tailRange.end!==range.total-1 || tailRange.total!==range.total
    || tail.body.length!==range.total-tailStart) throw new Error('Invalid MP4 end range.');
  if (requiresCors && (!cors(head.header,origin) || !cors(tail.header,origin)))
    throw new Error('MP4 with external captions requires CORS.');
  const duration=mp4Duration(head.body) ?? mp4Duration(tail.body);
  if (!duration) throw new Error('MP4 duration could not be verified within the probe budget.');
  return {duration,summary:`MP4 AVC and two byte ranges verified; CORS ${cors(head.header,origin)?'present':'not required for native MP4 without external tracks'}.`};
}

function childUrl(parent:string,reference:string,base:string) {
  if (!reference || /[\s\\?#%]/.test(reference) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(reference))
    throw new Error('Manifest contains an unsafe URL.');
  const url = new URL(reference,parent);
  if (!approvedMediaUrl(url.href) || !url.href.startsWith(base))
    throw new Error('Manifest target is outside the authorized edition directory.');
  return url.href;
}
async function checkHls(fetcher:Fetcher,url:string,origin:string,signal:AbortSignal) {
  const base=new URL('./',url).href;
  const manifest = async (path:string) => {
    const result=await probe(fetcher,path,origin,signal,undefined,65536);
    if (!/^(application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)(?:;|$)/i.test(result.header.get('content-type') ?? '') || !cors(result.header,origin))
      throw new Error('HLS manifest lacks compatible MIME type or CORS.');
    const text=ascii.decode(result.body);
    if (!/^#EXTM3U(?:\r?\n|$)/.test(text) ||
      /#EXT-X-(?:SESSION-KEY|SESSION-DATA|KEY|MAP|BYTERANGE|I-FRAME-STREAM-INF|MEDIA|DEFINE|CONTENT-STEERING|PRELOAD-HINT|PART|RENDITION-REPORT):/.test(text))
      throw new Error('Only clear, self-contained MPEG-TS VOD playlists are eligible automatically.');
    return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  };
  const first=await manifest(url);
  const variants=first.flatMap((line,i)=>line.startsWith('#EXT-X-STREAM-INF:')?[{line,uri:first[i+1]}]:[]);
  if (variants.length>4) throw new Error('HLS variants exceed the bounded compatibility check.');
  if (variants.length && (first.filter(line=>!line.startsWith('#')).length!==variants.length ||
    variants.some(({line,uri})=>!uri || uri.startsWith('#') || !/CODECS="avc1\.[\da-f]+(?:,mp4a\.40\.\d+)?"(?:,|$)/i.test(line))))
    throw new Error('HLS uses unsupported or unspecified codecs.');
  const playlists = variants.length ? variants.map(({uri})=>childUrl(url,uri,base)):[url];
  const durations:number[]=[];
  for (const path of playlists) {
    const lines = path===url ? first : await manifest(path);
    if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('HLS playlist is not a complete VOD.');
    const segments = lines.filter(line=>!line.startsWith('#')).map(line=>childUrl(path,line,base));
    const lengths = lines.filter(line=>line.startsWith('#EXTINF:')).map(line=>Number(line.slice(8).split(',')[0]));
    if (!segments.length || segments.length!==lengths.length || lengths.some(n=>!Number.isFinite(n)||n<=0))
      throw new Error('HLS segment timing is invalid.');
    durations.push(lengths.reduce((sum,n)=>sum+n,0));
    for (const segment of new Set([segments[0],segments[Math.floor(segments.length/2)],segments.at(-1)!])) {
      const {body,header}=await probe(fetcher,segment,origin,signal,'bytes=0-1023',1024);
      const range=parseRange(header);
      if (range.start!==0 || range.end!==body.length-1 || !/^video\/mp2t(?:;|$)/i.test(header.get('content-type') ?? '') ||
        !cors(header,origin) || body.length<188*2 || body[0]!==0x47 || body[188]!==0x47)
        throw new Error('An HLS seek sample failed MPEG-TS, CORS, or byte-range validation.');
    }
  }
  if (Math.max(...durations)-Math.min(...durations)>2) throw new Error('HLS variant durations disagree.');
  return {duration:durations[0],summary:`Clear HLS VOD, CORS and start/middle/end segment ranges verified across ${playlists.length} rendition(s).`};
}

export function checkStagedMp4(edition:Pick<Edition,'durationSeconds'>,metadata:Uint8Array) {
  const duration=mp4Duration(metadata);
  if (!duration) throw new Error('Staged MP4 duration could not be verified.');
  const result={duration,summary:'Staged MP4 hash, AVC, and duration verified. Host playback uses the recorded browser evidence.'};
  assertDuration(edition,result);
  return result;
}

function assertDuration(edition:Pick<Edition,'durationSeconds'>,result:CheckResult) {
  if (!Number.isFinite(result.duration) || Math.abs(result.duration-edition.durationSeconds)>Math.min(10,Math.max(2,edition.durationSeconds*.015)))
    throw new Error('Measured duration does not match the preauthorized edition.');
}

export async function checkMedia(edition:Edition,origin:string,signal:AbortSignal,fetcher:Fetcher=fetch):Promise<CheckResult> {
  const result = edition.format==='mp4'
    ? await checkMp4(fetcher,edition.url,origin,signal,!!edition.subtitles?.length)
    : await checkHls(fetcher,edition.url,origin,signal);
  assertDuration(edition,result);
  for (const track of edition.subtitles ?? []) {
    const {body,header}=await probe(fetcher,track.url,origin,signal,undefined,65536);
    if (!/^text\/vtt(?:;|$)/i.test(header.get('content-type') ?? '') || !cors(header,origin) ||
      !/^WEBVTT(?:[\s\r\n]|$)/.test(ascii.decode(body)))
      throw new Error('An authorized caption did not pass WebVTT and CORS checks.');
  }
  return result;
}
