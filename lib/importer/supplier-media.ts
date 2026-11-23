import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { checkOwnedMedia } from './owned-media.ts';

export interface StagedAsset { file: string; sha256: string }
export interface MediaStorage {
  verifyVideo(url:string, format:'mp4'|'hls', durationSeconds:number, asset:StagedAsset|undefined, signal:AbortSignal):Promise<void>;
  readSubtitle(asset:StagedAsset, signal:AbortSignal):Promise<string>;
}

const digest=/^[a-f0-9]{64}$/;
async function readStaged(root:string, asset:StagedAsset, extension:string, limit:number, signal:AbortSignal) {
  if (!digest.test(asset.sha256) || asset.file!==`${asset.sha256}.${extension}`) throw new Error('Invalid staged asset filename or digest.');
  if (!(await lstat(root)).isDirectory()) throw new Error('The staging directory must be local.');
  const parent=await realpath(root);
  const path=join(parent,asset.file);
  const entry=await lstat(path);
  if (entry.size>limit || !entry.isFile() || await realpath(path)!==path) throw new Error('Staged asset must be a bounded regular file.');
  const file=await open(path,'r');
  try {
    const bytes=Buffer.alloc(entry.size);
    signal.throwIfAborted();
    const {bytesRead}=await file.read(bytes,0,bytes.length,0);
    if (bytesRead!==entry.size || createHash('sha256').update(bytes).digest('hex')!==asset.sha256) throw new Error('Staged asset hash mismatch.');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally { await file.close(); }
}

function cueTime(value:string) {
  const parts=/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  return parts ? Number(parts[1] || 0)*3600+Number(parts[2])*60+Number(parts[3])+Number(parts[4])/1000 : NaN;
}

export function validateWebVtt(text:string, durationSeconds:number) {
  const blocks=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trimEnd().split(/\n[ \t]*\n/);
  if (!/^WEBVTT(?:[ \t][^\n]*)?\n?$/.test(blocks.shift() ?? '')) throw new Error('Invalid WebVTT header.');
  let previous=-1;
  for (const block of blocks) {
    if (/^(?:NOTE(?:[ \t]|$)|STYLE\n|REGION\n)/.test(block)) continue;
    const lines=block.split('\n');
    const line=lines[0].includes('-->') ? 0 : 1;
    const cue=/^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t].*)?$/.exec(lines[line] ?? '');
    const start=cue ? cueTime(cue[1]) : NaN;
    const end=cue ? cueTime(cue[2]) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start<previous || end<=start || end>durationSeconds+0.05 || !lines[line+1]?.trim())
      throw new Error('Invalid or out-of-range WebVTT cue.');
    previous=start;
  }
  if (previous<0) throw new Error('The WebVTT file has no valid cues.');
}

export function validateVodPlaylist(text:string, expectedDuration:number) {
  const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if (lines[0]!=='#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')) throw new Error('Expected a complete HLS VOD media playlist.');
  let duration=0;
  let awaitingSegment=false;
  for (const line of lines.slice(1)) {
    if (/^#EXT-X-(?:KEY|SESSION-KEY):(?!METHOD=NONE$)/.test(line)) throw new Error('Encrypted HLS needs a separate approved integration.');
    if (line.startsWith('#EXTINF:')) {
      const seconds=Number(line.slice(8).split(',')[0]);
      if (awaitingSegment || !Number.isFinite(seconds) || seconds<=0) throw new Error('Invalid HLS segment timing.');
      duration+=seconds;
      awaitingSegment=true;
    } else if (!line.startsWith('#')) {
      if (!awaitingSegment) throw new Error('Missing HLS segment timing.');
      awaitingSegment=false;
    }
  }
  if (awaitingSegment || duration<=0 || Math.abs(duration-expectedDuration)>3) throw new Error('HLS variant duration differs from the reviewed edition.');
}

export function externalAndStagedStorage(directory:string):MediaStorage {
  return {
    async verifyVideo(url,format,durationSeconds,asset,signal) {
      // External availability, ranges, variants and all media-host controls are attested by release QA.
      // Never fetch a URL submitted by a supplier from this process.
      if (!asset) return;
      if (format==='hls') {
        validateVodPlaylist(await readStaged(join(directory,'supplier-assets'),asset,'m3u8',2_000_000,signal),durationSeconds);
        return;
      }
      const filename=/^([a-zA-Z0-9][a-zA-Z0-9_.-]{0,79})-[a-f0-9]{64}\.mp4$/.exec(asset.file);
      if (!filename || !digest.test(asset.sha256) || asset.file!==`${filename[1]}-${asset.sha256}.mp4` || !url.endsWith(`/${asset.file}`))
        throw new Error('Staged MP4 must use its content-addressed name on the playback host.');
      const origin=new URL(url).origin;
      // Reuse the bounded MP4 inspection on the local copy, where the file can be addressed without a network probe.
      const edition={url:`${origin}/streamframe-media/${asset.file}`,candidateId:filename[1],format:'mp4' as const,mediaSha256:asset.sha256,durationSeconds};
      await checkOwnedMedia(directory,edition,origin,signal,24_000_000_000);
    },
    readSubtitle:(asset,signal)=>readStaged(join(directory,'supplier-assets'),asset,'vtt',2_000_000,signal),
  };
}
