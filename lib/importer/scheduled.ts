import 'server-only';
import {join} from 'node:path';
import {databasePool,type SqlPool} from '../database/connection.ts';
import {verifyOperation} from '../operations.ts';
import {productionConfig} from '../production-config.ts';
import {operatorRegistry} from '../registry-runtime.ts';
import type {RegistrySource} from '../registry-schema.ts';
import {runImport} from './runtime.ts';
import {runSupplierPackage} from './package-runtime.ts';

export function rightsSummary(entries:RegistrySource[],now=Date.now()) {
  let expired=0,expiringWithinWeek=0;
  for(const entry of entries) {
    if(!entry.enabled) continue;
    const end=entry.supplierRelease?.rights.expiresAt ?? entry.provenance?.releaseReview?.automation?.validUntil;
    if(!end) continue;
    const remaining=Date.parse(end)-now;
    if(remaining<=0) expired++;
    else if(remaining<=7*86400000) expiringWithinWeek++;
  }
  return {expired,expiringWithinWeek};
}

export function packagePins(value='') {
  if(!value) return [];
  const pins=value.split(',');
  if(pins.length>16 || pins.some(pin=>! /^[a-f0-9]{64}$/.test(pin))) throw new Error('Invalid reviewed package list.');
  return [...new Set(pins)];
}

export async function withScheduledLock(pool:SqlPool,work:()=>Promise<void>) {
  const client=await pool.connect();
  try {
    const result=await client.query('SELECT pg_try_advisory_lock(1937006962, 10) AS acquired');
    if(result.rows[0].acquired!==true) return false;
    try {await work();} finally {await client.query('SELECT pg_advisory_unlock(1937006962, 10)');}
    return true;
  } finally {client.release();}
}

export async function scheduledRun(signal:AbortSignal) {
  productionConfig('scheduler');
  await verifyOperation('sync',process.env);
  const pins=packagePins(process.env.STREAMFRAME_PACKAGE_DIGESTS);
  return withScheduledLock(databasePool('operator'),async()=>{
    const rights=rightsSummary(await operatorRegistry().read());
    console.info(JSON.stringify({event:'license_window',...rights}));
    let invalid=0;
    for(const pin of pins) {
      signal.throwIfAborted();
      try {await runSupplierPackage(join(process.cwd(),'data','supplier-packages',pin+'.json'),false,signal,pin);}
      catch {invalid++;}
    }
    console.info(JSON.stringify({event:'package_validation',checked:pins.length,invalid}));
    const result=await runImport('due',signal);
    const run=result.state.history[0];
    const failed=!result.skipped && (run.status!=='complete' || run.playbackFailed>0);
    console.info(JSON.stringify({event:'supplier_sync',skipped:result.skipped,errors:result.skipped?0:run.errors,
      published:result.skipped?0:run.published,playbackFailed:result.skipped?0:run.playbackFailed}));
    if(invalid || failed) throw new Error('Content job needs review.');
  });
}
