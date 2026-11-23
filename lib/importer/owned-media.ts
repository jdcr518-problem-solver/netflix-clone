import { createHash } from 'node:crypto';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { checkStagedMp4 } from './media.ts';
import { ownedEditionName, type Edition } from './policy.ts';

async function readBytes(file:FileHandle,position:number,length:number) {
  const buffer=Buffer.alloc(length);
  const {bytesRead}=await file.read(buffer,0,length,position);
  if (bytesRead!==length) throw new Error('Staged media changed during verification.');
  return buffer;
}

export async function movieMetadata(file:FileHandle,total:number,signal:AbortSignal) {
  let position=0;
  // Read box headers and skip the sample data. Publisher masters can have large sample tables.
  for (let count=0;count<128 && position+8<=total;count++) {
    signal.throwIfAborted();
    const header=await readBytes(file,position,8);
    const type=header.toString('ascii',4,8);
    const field=header.readUInt32BE(0);
    const headerLength=field===1?16:8;
    const length=field===1 ? Number((await readBytes(file,position+8,8)).readBigUInt64BE()) : field || total-position;
    if (length<headerLength || length>total-position || (position===0 && type!=='ftyp')) break;
    if (type==='moov' && length<=16*1024*1024 && headerLength===8) return readBytes(file,position,length);
    position+=length;
  }
  throw new Error('Staged MP4 lacks a supported movie metadata box.');
}

export async function checkOwnedMedia(directory:string,edition:Pick<Edition,'candidateId'|'url'|'format'|'mediaSha256'|'subtitles'|'durationSeconds'>,
  origin:string,signal:AbortSignal,maxBytes=1_600_000_000) {
  const name=ownedEditionName(edition,origin);
  if (!name) throw new Error('Invalid owned-media path.');
  const parent=await realpath(directory);
  const folder=join(parent,'owned-media');
  const path=join(folder,name);
  const fileEntry=await lstat(path);
  if (!(await lstat(folder)).isDirectory() || !fileEntry.isFile() ||
    relative(parent,await realpath(path))!==relative(parent,path)) throw new Error('Owned media must be a regular staged file.');
  const file=await open(path,'r');
  try {
    const before=await file.stat();
    if (before.size<16 || before.size>maxBytes) throw new Error('Owned MP4 exceeds the local verification budget.');
    const hash=createHash('sha256');
    for await (const chunk of file.createReadStream({autoClose:false,signal})) hash.update(chunk);
    if (hash.digest('hex')!==edition.mediaSha256) throw new Error('Staged file does not match the approved SHA-256.');
    const result=checkStagedMp4(edition,await movieMetadata(file,before.size,signal));
    const after=await file.stat();
    if (after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs)
      throw new Error('Staged media changed during verification.');
    return result;
  } finally { await file.close(); }
}
