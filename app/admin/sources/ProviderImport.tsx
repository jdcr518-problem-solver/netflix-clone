'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { FilmCandidate } from '../../../lib/providers/blender';
import type { FilmMatch } from '../../../lib/providers/matching';
import type { RegistrySource } from '../../../lib/registry-schema';

type Result = {id:string;title:string;year?:number};
const endpoint = '/api/admin/providers';

export default function ProviderImport({onImported}:{onImported:(sources:RegistrySource[])=>void}) {
  const [provider,setProvider] = useState<FilmCandidate['provider']>('blender');
  const [query,setQuery] = useState('');
  const [results,setResults] = useState<Result[]>();
  const [review,setReview] = useState<{candidate:FilmCandidate;matches:FilmMatch[]|null;editions:{url:string;approved:boolean;active:boolean;playbackNotes?:string}[]}>();
  const [fileName,setFileName] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const rejected = useRef(new Set<string>());
  useEffect(() => {
    const modal = dialog.current;
    if (!review || !modal) return;
    modal.showModal();
    return () => modal.close();
  },[review]);

  async function request(params:URLSearchParams,options?:RequestInit) {
    const response = await fetch(`${endpoint}?${params}`,options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Provider request failed.');
    return data;
  }
  async function search(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);setError('');setStatus('');
    try {
      const data = await request(new URLSearchParams({provider,q:query}));
      setResults(data.results);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Search failed.'); }
    finally { setBusy(false); }
  }
  async function open(id:string) {
    setBusy(true);setError('');setStatus('');
    try { setFileName(''); setReview(await request(new URLSearchParams({provider,id}))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot open candidate.'); }
    finally { setBusy(false); }
  }
  async function approve(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review) return;
    const form = new FormData(event.currentTarget);
    const candidate = review.candidate;
    setBusy(true);setError('');
    try {
      const data = await request(new URLSearchParams(),{
        method:'POST',headers:{'Content-Type':'application/json','X-StreamFrame-Admin':'1'},
        body:JSON.stringify({provider:candidate.provider,id:candidate.id,file:form.get('file'),
          tmdbId:Number(form.get('tmdbId')),owner:form.get('owner'),permittedUse:form.get('use'),
          attribution:form.get('attribution'),commercialRestrictions:form.get('restrictions'),
          evidenceUrl:form.get('evidence'),releaseReview:{
            licenseName:form.get('licenseName'),licenseUrl:form.get('licenseUrl'),
            hostingEvidenceUrl:form.get('hostingEvidence'),hostingNotes:form.get('hostingNotes'),
            playbackNotes:form.get('playbackNotes'),modificationNotice:form.get('modifications'),
            creditsVerified:form.has('creditsVerified'),playbackPassed:form.has('playbackPassed'),
          },approved:form.has('approved'),includeSubtitles:form.has('subtitles')}),
      });
      onImported(data.sources);
      setReview(undefined);
      setStatus(`${candidate.title} approved and registered as ${data.sourceId}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }

  const candidate = review?.candidate;
  const file = candidate?.files.find(entry => entry.name === fileName);
  const edition = review?.editions.find(entry => entry.url === file?.url);
  return <section className="sa-panel sa-provider" aria-labelledby="provider-heading">
    <header className="sa-feedback"><h2 id="provider-heading">Provider discovery</h2><p>Find a complete film, verify its rights, and match it to TMDB before registering playback.</p></header>
    <form className="sa-filters sa-provider-filters" onSubmit={search}>
      <label>Provider<select value={provider} disabled={busy} onChange={event => {setProvider(event.target.value as FilmCandidate['provider']);setResults(undefined);}}>
        <option value="blender">Blender Open Movies</option><option value="archive">Internet Archive</option>
      </select></label>
      <label>Film title<input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder="Search by title" /></label>
      <button type="submit" disabled={busy}>{busy && !review ? 'Working…' : 'Search provider'}</button>
    </form>
    {status && <p className="sa-feedback" role="status">{status}</p>}
    {error && !review && <p className="sa-feedback sa-error" role="alert">{error}</p>}
    {results && !results.length && <p className="sa-empty">No matching films found.</p>}
    {!!results?.length && <ul className="sa-provider-results">
      {results.map(result => <li key={result.id}><span>{result.title || result.id} {result.year && `(${result.year})`}</span>
        <button disabled={busy || rejected.current.has(`${provider}:${result.id}`)} onClick={() => void open(result.id)}>
          {rejected.current.has(`${provider}:${result.id}`) ? 'Rejected' : 'Review film'}
        </button></li>)}
    </ul>}
    {candidate && <dialog ref={dialog} className="sa-dialog" aria-label="Review provider film"
      onCancel={event => {event.preventDefault();if (!busy) {setReview(undefined);setError('');}}}>
      <header><h2>{candidate.title} {candidate.year && `(${candidate.year})`}</h2>
        <button aria-label="Close review" disabled={busy} onClick={() => {setReview(undefined);setError('');}}>×</button></header>
      {candidate.description && <p>{candidate.description}</p>}
      {candidate.director && <p>{candidate.director} · {candidate.runtime} min · Complete short film</p>}
      <p className="sa-feedback"><a href={candidate.originalPage} target="_blank" rel="noreferrer">Original content page</a>
        {candidate.evidence && <> · <a href={candidate.evidence} target="_blank" rel="noreferrer">Publisher evidence</a></>}</p>
      {!candidate.evidence && <p className="sa-feedback sa-error" role="status">Independent rights evidence is missing. Verify it before approval.</p>}
      {candidate.creditsRequirement && <p>{candidate.creditsRequirement}</p>}
      <p>Reported license: {candidate.licenseClaim || 'Unverified / not supplied'}</p>
      <p className="sa-feedback">{candidate.playbackNote}</p>
      {!!candidate.publisherEditions?.length && <ul aria-label="Publisher release downloads">
        {candidate.publisherEditions.map(edition => <li key={edition.url}>
          <a href={edition.url} target="_blank" rel="noreferrer">{edition.name}</a> · {Math.round(edition.bytes/1_000_000)} MB download
        </li>)}
      </ul>}
      {!!candidate.subtitleNotes.length && <p>Subtitle notes: {candidate.subtitleNotes.join(' · ')}</p>}
      {error && <p className="sa-feedback sa-error" role="alert">{error}</p>}
      <form onSubmit={approve} className="sa-form">
        <div className="sa-fields">
          <label className="sa-wide">Video file<select name="file" required value={fileName} onChange={event=>setFileName(event.target.value)}><option value="" disabled>Select the verified full film</option>
            {candidate.files.map(file => <option key={file.url} value={file.name}>{file.name} · {file.format.toUpperCase()} · {new URL(file.url).hostname}</option>)}</select></label>
          {file && <div className="sa-wide">
            <p className="sa-edition-url"><a href={file.url} target="_blank" rel="noreferrer">{file.url}</a></p>
            <p>Edition status: {edition?.approved ? edition.active ? 'Approved and enabled' : 'Approved, disabled' : 'Pending release approval'}</p>
            <p>Playback test: {edition?.playbackNotes ?? file.testStatus ?? 'No playback result recorded.'}</p>
          </div>}
          <label className="sa-wide">TMDB match<select name="tmdbId" required defaultValue=""><option value="" disabled>Select the verified title and edition</option>
            {review.matches?.map(match => <option key={match.id} value={match.id}>{match.title} ({match.release_date.slice(0,4)}) · #{match.id}{match.director && ` · ${match.director}`}{match.runtime ? ` · ${match.runtime} min` : ''}</option>)}</select></label>
          {review.matches === null && <p className="sa-wide" role="status">TMDB could not be reached. Close and reopen this review to retry.</p>}
          {review.matches?.length === 0 && <p className="sa-wide" role="status">No exact TMDB title and year match. Provider metadata remains available here, but this film cannot enter the catalog.</p>}
          <label>License name<input name="licenseName" maxLength={100} required defaultValue={candidate.licenseUrl ? candidate.licenseClaim : undefined} /></label>
          <label>License link<input name="licenseUrl" type="url" maxLength={500} required defaultValue={candidate.licenseUrl} /></label>
          <label>Hosting evidence link<input name="hostingEvidence" type="url" maxLength={500} required /></label>
          <label>Hosting restrictions or permission<input name="hostingNotes" maxLength={500} required /></label>
          <label>Playback test result<input name="playbackNotes" maxLength={500} required placeholder="Record the device and seek result" /></label>
          <label>Modification notice<input name="modifications" maxLength={300} required placeholder="Use No modifications if confirmed" /></label>
          <label>Content owner<input name="owner" maxLength={200} required defaultValue={candidate.owner} /></label>
          <label>Rights evidence URL<input name="evidence" type="url" maxLength={500} required defaultValue={candidate.evidence} /></label>
          <label>Permitted use<input name="use" maxLength={500} required placeholder="Document in-app streaming permission" /></label>
          <label>Commercial restrictions<input name="restrictions" maxLength={500} required placeholder="Include applicable restrictions" /></label>
          <label className="sa-wide">Attribution<input name="attribution" maxLength={300} required defaultValue={candidate.attribution} /></label>
          {!!candidate.subtitles.length && <label className="sa-check"><input name="subtitles" type="checkbox" /> Register the listed WebVTT tracks after verifying their rights</label>}
          <label className="sa-check"><input name="creditsVerified" type="checkbox" required /> I checked the required credits in this exact video.</label>
          <label className="sa-check"><input name="playbackPassed" type="checkbox" required /> This exact file passed playback and seeking checks.</label>
          <label className="sa-check"><input name="approved" type="checkbox" required /> I verified the full film and TMDB edition, distribution rights, attribution, and the media host’s playback terms.</label>
        </div>
        <footer><button type="button" disabled={busy} onClick={() => {
          rejected.current.add(`${candidate.provider}:${candidate.id}`);
          setStatus(`${candidate.title} rejected for this review session.`);
          setReview(undefined);
          setError('');
        }}>Reject candidate</button>
          <button className="sa-primary" type="submit" disabled={busy || !review.matches?.length || !candidate.files.length}>{busy ? 'Registering…' : 'Approve and register'}</button></footer>
      </form>
    </dialog>}
  </section>;
}
