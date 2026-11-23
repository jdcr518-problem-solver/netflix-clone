import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ImportState } from './sync.ts';

export const emptyImportState = ():ImportState => ({version:1,configHash:'',nextScope:0,cursors:{},candidates:[],history:[]});
export function validateImportState(value:unknown):ImportState {
  const state=structuredClone(value) as ImportState;
    const count=(value:unknown)=>Number.isSafeInteger(value) && Number(value)>=0;
    const timestamp=(value:unknown)=>typeof value==='string' && Number.isFinite(Date.parse(value));
    if (state?.version!==1 || !Array.isArray(state.history) || state.history.length>20 ||
      !Array.isArray(state.candidates) || state.candidates.length>350 ||
      typeof state.configHash!=='string' || (state.configHash!=='' && !/^[a-f0-9]{64}$/.test(state.configHash)) ||
      !state.cursors || typeof state.cursors!=='object' || Array.isArray(state.cursors) ||
      !count(state.nextScope) || Object.values(state.cursors).some(cursor=>!cursor || !count(cursor.page) || cursor.page<1 || !count(cursor.offset)) ||
      state.history.some(run=>!run || !timestamp(run.startedAt) || (run.endedAt!==undefined && !timestamp(run.endedAt)) ||
        !['running','complete','partial','interrupted'].includes(run.status) || !Array.isArray(run.messages) ||
        run.messages.some(message=>typeof message!=='string') ||
        ![run.discovered,run.newTitles,run.published,run.pending,run.rejected,run.playbackFailed,run.errors].every(count)) ||
      state.candidates.some(item=>!item || typeof item.key!=='string' || !/^(blender|archive):[^\s]+$/.test(item.key) ||
        typeof item.title!=='string' || typeof item.reason!=='string' || typeof item.page!=='string' || !timestamp(item.checkedAt) ||
        !['pending','rejected','published','already-registered','playback-failed','import-error'].includes(item.status)))
      throw new Error('Malformed import checkpoint.');
    const seen=new Set<string>();
    state.candidates=state.candidates.flatMap((item:ImportState['candidates'][number])=>{
      const parts=item.key.split(':');
      const key=`${parts[0]}:${parts.at(-1)}`;
      if(seen.has(key)) return [];
      seen.add(key);
      return [{...item,key}];
    });
    return state as ImportState;
}

export async function readImportState(path:string):Promise<ImportState> {
  try {
    const state=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
    return validateImportState(state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return emptyImportState();
    throw error;
  }
}

export async function saveImportState(path:string,state:ImportState) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tmp,'wx',0o600);
  try {
    try { await handle.writeFile(JSON.stringify(state,null,2)+'\n','utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp,path);
  } finally { await unlink(tmp).catch(()=>{}); }
}
