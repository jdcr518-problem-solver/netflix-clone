'use client';

import { useEffect, useState } from 'react';
import type { ImportState } from '../../../lib/importer/sync';

const url='/api/admin/sync';
const statusNames={
  pending:'Pending review',rejected:'Rejected',published:'Automatically published',
  'already-registered':'Already registered','playback-failed':'Playback check failed','import-error':'Import error',
};

export default function ImportMonitor({onFinished}:{onFinished:()=>void}) {
  const [state,setState]=useState<ImportState>();
  const [loading,setLoading]=useState(true);
  const [running,setRunning]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch(url,{signal:controller.signal}).then(async response=>{
      if(!response.ok) throw new Error('Import status could not be loaded.');
      const result=await response.json();
      if(!controller.signal.aborted)setState(result.state);
    }).catch(()=>{if(!controller.signal.aborted)setError('Import status could not be loaded.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[]);

  async function sync(){
    setError('');setRunning(true);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-StreamFrame-Admin':'1'}});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error ?? 'Synchronization failed.');
      setState(data.state);
      onFinished();
    }catch(cause){setError(cause instanceof Error?cause.message:'Synchronization failed.');}
    finally{setRunning(false);}
  }

  const last=state?.history[0];
  const candidates=state?.candidates ?? [];
  return <section className="sa-panel sa-provider sa-sync" aria-labelledby="sync-heading">
    <header className="sa-feedback sa-sync-header">
      <div><h2 id="sync-heading">Import synchronization</h2>
        <p>{loading?'Loading import status…':last?`Last run: ${new Date(last.startedAt).toLocaleString()} · ${last.status}`:'No synchronization run recorded.'}</p></div>
      <button className="sa-primary" onClick={()=>void sync()} disabled={running || loading}>{running?'Synchronizing…':'Run Sync Now'}</button>
    </header>
    {running && <p className="sa-feedback" role="status">Checking provider pages and release policies…</p>}
    {error && <p className="sa-feedback sa-error" role="alert">{error}</p>}
    {!!state?.history.length && <>
      <div className="sa-feedback sa-sync-counts">
        <span>Tracked candidates <strong>{candidates.length}</strong></span>
        <span>Published this run <strong>{last?.published ?? 0}</strong></span>
        <span>Pending <strong>{candidates.filter(item=>item.status==='pending').length}</strong></span>
        <span>Rejected <strong>{candidates.filter(item=>item.status==='rejected').length}</strong></span>
        <span>Playback failures <strong>{candidates.filter(item=>item.status==='playback-failed').length}</strong></span>
        <span>Run errors <strong>{last?.errors ?? 0}</strong></span>
      </div>
      <div className="sa-table-scroll" aria-label="Import candidates" role="region" tabIndex={0}>
        <table><thead><tr><th>Candidate</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>{candidates.slice(0,25).map(item=><tr key={item.key}>
            <td>{item.page ? <a href={item.page} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
              <small>{[item.year,item.owner,item.license].filter(Boolean).join(' · ')}</small>
              <small>{item.formats?.length ? [...new Set(item.formats)].join(', ').toUpperCase() : ''}{item.subtitleNotes?.length ? ` · ${item.subtitleNotes.length} listed subtitle file(s)` : ''}</small></td>
            <td>{statusNames[item.status]}</td><td>{item.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <details className="sa-feedback"><summary>Synchronization history</summary>
        <ul>{state.history.map(run=><li key={run.startedAt}>{new Date(run.startedAt).toLocaleString()} · {run.status} · {run.discovered} seen · {run.newTitles} new · {run.published} published · {run.errors} errors
          {run.messages.length>0 && <ul>{run.messages.map((message,index)=><li key={index}>{message}</li>)}</ul>}</li>)}</ul>
      </details>
    </>}
  </section>;
}
