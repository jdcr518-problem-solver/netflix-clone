'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { RegistrySource } from '../../../lib/registry-schema';
import type { SubtitleSource } from '../../../types/playback';
import ProviderImport from './ProviderImport';
import ImportMonitor from './ImportMonitor';
import type { RegistryCommand } from '../../../lib/registry-file';

const endpoint = '/api/admin/sources';
const targetLabel = (target: RegistrySource['target']) => target.namespace === 'tmdb'
  ? target.type === 'movie' ? `Movie ${target.tmdbId}` : `TV ${target.tmdbId} · S${target.season} E${target.episode}`
  : target.demoId;

function Modal({title,children,onClose,busy}: {title:string;children:ReactNode;onClose:()=>void;busy:boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="sa-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{title}</h2><button type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button></header>
    {children}
  </dialog>;
}

function SourceForm({source,busy,onSubmit,onClose}: {
  source?:RegistrySource;busy:boolean;onSubmit:(value:object)=>void;onClose:()=>void;
}) {
  const target = source?.target;
  const reviewed = !!(source?.provenance || source?.supplierRelease);
  const [type,setType] = useState(target?.type ?? 'movie');
  const [subtitles,setSubtitles] = useState<SubtitleSource[]>(source?.subtitles ?? []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key:string) => String(form.get(key) ?? '').trim();
    const tmdbId = Number(value('tmdbId'));
    const target = {namespace:'tmdb',type,tmdbId,...(type === 'episode' ? {season:Number(value('season')),episode:Number(value('episode'))} : {})};
    const height = value('height');
    onSubmit({
      ...(source ? {} : {id:value('id'),target}),
      ...(reviewed ? {} : {url:value('url'),format:value('format'),rightsReference:value('rights'),
        subtitles:subtitles.length ? subtitles : source ? null : undefined}),
      enabled:form.has('enabled'),
      label:value('label') || (source ? null : undefined),
      quality:height ? {height:Number(height)} : source ? null : undefined,
    });
  }
  return <form className="sa-form" onSubmit={submit}>
    <div className="sa-fields">
      <label>Source ID<input name="id" required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" defaultValue={source?.id} readOnly={!!source} /></label>
      <label>Media type<select value={type} disabled={!!source} onChange={event => setType(event.target.value as 'movie'|'episode')}><option value="movie">Movie</option><option value="episode">Episode</option></select></label>
      <label>TMDB {type === 'movie' ? 'movie' : 'series'} ID<input name="tmdbId" type="number" min="1" required defaultValue={target?.namespace === 'tmdb' ? target.tmdbId : undefined} readOnly={!!source} /></label>
      {type === 'episode' && <>
        <label>Season number<input name="season" type="number" min="0" required defaultValue={target?.type === 'episode' ? target.season : 1} readOnly={!!source} /></label>
        <label>Episode number<input name="episode" type="number" min="1" required defaultValue={target?.type === 'episode' ? target.episode : 1} readOnly={!!source} /></label>
      </>}
      <label>Format<select name="format" disabled={reviewed} defaultValue={source?.format ?? 'mp4'}><option value="mp4">MP4</option><option value="hls">HLS</option></select></label>
      <label>Source label <small>(optional)</small><input name="label" maxLength={100} defaultValue={source?.label} /></label>
      <label>Quality height <small>(optional)</small><input name="height" type="number" min="1" placeholder="1080" defaultValue={source?.quality?.height} /></label>
      <label className="sa-wide">Authorized video URL<input name="url" type="url" maxLength={2048} placeholder="https://media.example.com/title.mp4" required readOnly={reviewed} defaultValue={source?.url} /></label>
      <label className="sa-wide">Ownership or license reference<input name="rights" required readOnly={reviewed} maxLength={500} defaultValue={source?.rightsReference} /></label>
      <label className="sa-check"><input name="enabled" type="checkbox" defaultChecked={source?.enabled ?? false} /> Enabled for playback</label>
    </div>
    <fieldset className="sa-subtitles" disabled={reviewed}><legend>Subtitles <small>(optional)</small></legend>
      {subtitles.map((track,index) => <div className="sa-caption" key={index}>
        {(['id','language','label','url'] as const).map(field => <label key={field}>{({id:'Track ID', language:'Language', label:'Caption label', url:'WebVTT URL'})[field]}
          <input required value={track[field]} onChange={event => setSubtitles(previous => previous.map((entry,i) => i === index ? {...entry,[field]:event.target.value} : entry))} />
        </label>)}
        <button type="button" onClick={() => setSubtitles(previous => previous.filter((_,i) => i !== index))}>Remove caption</button>
      </div>)}
      <button type="button" onClick={() => setSubtitles(previous => [...previous,{id:'',language:'',label:'',url:''}])}>Add caption</button>
    </fieldset>
    <footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="sa-primary" disabled={busy}>{busy ? 'Saving…' : 'Save source'}</button></footer>
  </form>;
}

export default function SourcesDashboard() {
  const [sources,setSources] = useState<RegistrySource[]>([]);
  const [loading,setLoading] = useState(true);
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [dialogError,setDialogError] = useState('');
  const [notice,setNotice] = useState('');
  const [query,setQuery] = useState('');
  const [type,setType] = useState('');
  const [format,setFormat] = useState('');
  const [status,setStatus] = useState('');
  const [form,setForm] = useState<RegistrySource | 'add'>();
  const [remove,setRemove] = useState<RegistrySource>();

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint,{signal,cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load sources.');
      setSources(data.sources);
      setLoaded(true);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Unable to load sources.');
        setLoaded(false);
      }
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  },[]);

  async function mutate(command:RegistryCommand,source?:RegistrySource,patch?:object) {
    setBusy(true); setError(''); setDialogError(''); setNotice('');
    try {
      const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-StreamFrame-Admin':'1'},
        body:JSON.stringify({command,id:source?.id,version:source?.updatedAt,patch})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save the change.');
      setSources(data.sources);
      setForm(undefined);
      setRemove(undefined);
      setNotice(command === 'remove' ? 'Source removed.' : 'Source saved.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to save the change.';
      if (form || remove) setDialogError(message);
      else setError(message);
    } finally { setBusy(false); }
  }

  const enabled = sources.filter(source => source.enabled).length;
  const movies = sources.filter(source => source.target.type === 'movie').length;
  const filtered = sources.filter(source => (
    `${source.id} ${source.label ?? ''} ${targetLabel(source.target)}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!type || source.target.type === type) && (!format || source.format === format) &&
    (!status || source.enabled === (status === 'enabled'))
  ));
  return <main className="sa">
    <div className="sa-shell">
      <header className="sa-heading">
        <div><p className="sa-eyebrow">StreamFrame / Local development</p><h1>Source registry</h1><p>Manage authorized movie and episode playback.</p></div>
        <button className="sa-primary" disabled={!loaded || loading || busy} onClick={() => {setDialogError('');setForm('add');}}>Add source</button>
      </header>
      <section aria-label="Registry totals" className="sa-totals">
        {[['Total sources',sources.length],['Movies',movies],['Episodes',sources.length-movies],['Enabled',enabled],['Disabled',sources.length-enabled]].map(([label,count]) =>
          <div key={label}><span>{label}</span><strong>{loading && !loaded ? '—' : count}</strong></div>)}
      </section>
      <section className="sa-panel" aria-label="Sources">
        <div className="sa-filters">
          <label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Source ID, label, or TMDB ID" /></label>
          <label>Type<select value={type} onChange={event => setType(event.target.value)}><option value="">All types</option><option value="movie">Movie</option><option value="episode">Episode</option></select></label>
          <label>Format<select value={format} onChange={event => setFormat(event.target.value)}><option value="">All formats</option><option value="mp4">MP4</option><option value="hls">HLS</option></select></label>
          <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
          <button disabled={loading || busy} onClick={() => void refresh()}>Reload list</button>
        </div>
        {loading && <p className="sa-feedback" role="status">Loading sources…</p>}
        {error && <p className="sa-feedback sa-error" role="alert">{error}</p>}
        {notice && <p className="sa-feedback" role="status">{notice}</p>}
        {loaded && !loading && !filtered.length && <p className="sa-empty">{sources.length ? 'No sources match these filters.' : 'No sources yet. Add an authorized video source to get started.'}</p>}
        {loaded && !!filtered.length && <div className="sa-table-scroll" role="region" aria-label="Source table" tabIndex={0}>
          <table><thead><tr><th>Source</th><th>Content</th><th>Format</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map(source => <tr key={source.id}>
            <td><strong>{source.label || source.id}</strong>{source.label && <small>{source.id}</small>}{source.provenance && <small>Approved import · {source.provenance.provider}</small>}{source.supplierRelease && <small>Supplier package · {source.supplierRelease.supplierId} / {source.supplierRelease.packageId}</small>}</td>
            <td>{targetLabel(source.target)}</td><td>{source.format.toUpperCase()}{source.quality && <small>{source.quality.height}p</small>}</td>
            <td><span className={source.enabled ? 'sa-enabled' : 'sa-disabled'}>{source.enabled ? 'Enabled' : 'Disabled'}</span></td>
            <td><div className="sa-actions">
              <button disabled={busy} onClick={() => {setDialogError('');setForm(source);}}>Edit</button>
              <button disabled={busy} onClick={() => void mutate(source.enabled ? 'disable' : 'enable',source)}>{source.enabled ? 'Disable' : 'Enable'}</button>
              <button disabled={busy} onClick={() => {setDialogError('');setRemove(source);}}>Remove</button>
            </div></td>
          </tr>)}</tbody></table>
        </div>}
      </section>
      <ProviderImport onImported={setSources} />
      <ImportMonitor onFinished={() => void refresh()} />
    </div>
    {form && <Modal title={form === 'add' ? 'Add source' : 'Edit source'} busy={busy} onClose={() => setForm(undefined)}>
      {dialogError && <p role="alert" className="sa-feedback sa-error">{dialogError}</p>}
      <SourceForm source={form === 'add' ? undefined : form} busy={busy} onClose={() => setForm(undefined)}
        onSubmit={patch => void (form === 'add' ? mutate('add',undefined,patch) : mutate('update',form,patch))} />
    </Modal>}
    {remove && <Modal title="Remove source?" busy={busy} onClose={() => setRemove(undefined)}>
      <p className="sa-feedback">Remove <strong>{remove.label || remove.id}</strong> from the playback registry?</p>
      {dialogError && <p role="alert" className="sa-feedback sa-error">{dialogError}</p>}
      <footer><button autoFocus disabled={busy} onClick={() => setRemove(undefined)}>Cancel</button><button className="sa-danger" disabled={busy} onClick={() => void mutate('remove',remove)}>Remove source</button></footer>
    </Modal>}
  </main>;
}
