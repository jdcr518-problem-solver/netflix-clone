import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,open,readFile,realpath,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validateVodPlaylist,validateWebVtt} from '../importer/supplier-media.ts';
import {movieMetadata} from '../importer/owned-media.ts';
import {checkStagedMp4} from '../importer/media.ts';
import {objectOrigin} from '../media-delivery.ts';

export const mime:Record<string,string>={mp4:'video/mp4',m3u8:'application/vnd.apple.mpegurl',ts:'video/mp2t',m4s:'video/iso.segment',vtt:'text/vtt',aac:'audio/aac'};
export type Asset={name:string;bytes:number;sha256:string;contentType:string};
const safeName=/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/;
const extension=(name:string)=>name.split('.').pop()!.toLowerCase();
async function hashFile(path:string) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
// One flat directory per edition. A grant authorizes every file under its digest.
export async function prepareEdition(directory:string,entry:string,duration:number,captions:string[]=[]) {
  if(!Number.isSafeInteger(duration)||duration<1||duration>86400||!safeName.test(entry)||
     !['mp4','m3u8'].includes(extension(entry))) throw new Error('Invalid edition entry or duration');
  if(!(await lstat(directory)).isDirectory()) throw new Error('Expected a private staging directory');
  const root=await realpath(directory);
  const names=(await readdir(root)).sort();
  const seen=new Set<string>(), visiting=new Set<string>(), assets:Asset[]=[];
  if(names.length>100000 || new Set(names.map(n=>n.toLowerCase())).size!==names.length) throw new Error('Oversized or ambiguous package');
  const files=new Set(names);
  async function inspect(name:string) {
    if(!safeName.test(name)||!files.has(name)||visiting.has(name)) throw new Error('Invalid, missing or cyclic package reference');
    if(seen.has(name)) return;
    visiting.add(name);
    const path=join(root,name),stat=await lstat(path),ext=extension(name);
    if(!Object.hasOwn(mime,ext)||!stat.isFile()||await realpath(path)!==path||!stat.size||stat.size>24e9) throw new Error('Invalid media object');
    if(ext==='m3u8'||ext==='vtt') {
      if(stat.size>2e6) throw new Error('Oversized text track or playlist');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path));
      if(ext==='vtt') validateWebVtt(text,duration);
      else {
        const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
        if(lines[0]!=='#EXTM3U') throw new Error('Expected HLS');
        const master=lines.some(line=>line.startsWith('#EXT-X-STREAM-INF:'));
        if(!master) validateVodPlaylist(text,duration);
        for(const line of lines) {
          if(!line.startsWith('#')) {
            if(master && extension(line)!=='m3u8') throw new Error('Expected variant playlist');
            await inspect(line);continue;
          }
          // Restrict the supported VOD grammar so unknown tags cannot add external resources.
          const tag=line.split(':')[0];
          if(!['#EXTM3U','#EXT-X-VERSION','#EXT-X-INDEPENDENT-SEGMENTS','#EXT-X-STREAM-INF','#EXT-X-MEDIA','#EXT-X-MAP','#EXTINF','#EXT-X-TARGETDURATION','#EXT-X-MEDIA-SEQUENCE','#EXT-X-PLAYLIST-TYPE','#EXT-X-ENDLIST','#EXT-X-DISCONTINUITY','#EXT-X-BYTERANGE'].includes(tag)) throw new Error('Unsupported playlist tag');
          if(line.includes('URI=')) {
            const refs=[...line.matchAll(/(?:[:,])URI="([^"]+)"/g)];
            if(!['#EXT-X-MEDIA','#EXT-X-MAP'].includes(tag)||refs.length!==1||line.split('URI=').length!==2) throw new Error('Invalid HLS URI');
            await inspect(refs[0][1]);
          }
        }
      }
    } else if(ext==='mp4') {
      const file=await open(path,'r');
      try {const header=Buffer.alloc(8);await file.read(header,0,8,0);if(header.toString('ascii',4)!=='ftyp') throw new Error('Invalid ISO media header');
        if(name===entry) checkStagedMp4({durationSeconds:duration},await movieMetadata(file,stat.size,AbortSignal.timeout(30000)));}
      finally {await file.close();}
    }
    if(['ts','aac','m4s'].includes(ext)) {
      const file=await open(path,'r');
      try {
        const header=Buffer.alloc(376);
        const {bytesRead}=await file.read(header,0,header.length,0);
        const valid=ext==='ts' ? bytesRead>=188 && stat.size%188===0 && header[0]===0x47 && (bytesRead<=188 || header[188]===0x47)
          : ext==='aac' ? bytesRead>=7 && header[0]===0xff && (header[1]&0xf6)===0xf0
          : bytesRead>=8 && ['moof','styp','sidx','ftyp'].includes(header.toString('ascii',4,8));
        if(!valid) throw new Error('Unsupported segment header');
      } finally {await file.close();}
    }
    assets.push({name,bytes:stat.size,sha256:await hashFile(path),contentType:mime[ext]});
    seen.add(name);visiting.delete(name);
  }
  await inspect(entry);
  for(const caption of captions) {if(extension(caption)!=='vtt') throw new Error('Expected WebVTT');await inspect(caption);}
  if(files.size!==seen.size) throw new Error('Unreferenced objects in edition');
  assets.sort((a,b)=>a.name<b.name?-1:1);
  const group=createHash('sha256').update(JSON.stringify({entry,assets})).digest('hex');
  return {group,entry,assets,locator:objectOrigin+'/'+group+'/'+entry};
}
