'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Play, Plus, X } from 'lucide-react';
import type { MediaItem } from '../types/movie';
import type { SeasonDetails, TitleDetails } from '../types/details';
import type { PlaybackOptions } from '../types/playback';
import { loadPlayback, preferredSource } from '../lib/streaming';
import { readProgress } from '../lib/playback-storage';
import { progressKey } from '../lib/playback-controls';
import { contentPath } from '../lib/content-path';
import { Artwork } from './Artwork';
import { CardTitle } from './CardTitle';
import FilmAttribution from './FilmAttribution';
import { VideoPlayer } from './VideoPlayer';

interface Props {
  item: MediaItem;
  details?: TitleDetails;
  inWatchlist: boolean;
  onClose: () => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onSelectSimilar: (item: MediaItem) => void;
}

async function json<T>(query: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/tmdb?${query}`, { signal });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

export function DetailModal({ item: initialItem, details, inWatchlist, onClose, onToggleWatchlist, onSelectSimilar }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState(details);
  const [error, setError] = useState(false);
  const [season, setSeason] = useState(details?.seasons[0]?.number);
  const [episodeData, setEpisodeData] = useState<{ season: number; data: SeasonDetails }>();
  const [episodeError, setEpisodeError] = useState<number>();
  const [options, setOptions] = useState<PlaybackOptions>();
  const [playing, setPlaying] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [lookupError, setLookupError] = useState(false);
  const launchRequest = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ReturnType<typeof readProgress>>({});
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => { if (!playing) setProgress(readProgress()); }, [playing]);

  useEffect(() => {
    if (details || !initialItem.tmdbId) return;
    const controller = new AbortController();
    const type = initialItem.type === 'series' ? 'tv' : 'movie';
    json<TitleDetails>(`action=details&type=${type}&id=${initialItem.tmdbId}`, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result);
        setSeason(result.seasons[0]?.number);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [details, initialItem.tmdbId, initialItem.type]);

  useEffect(() => {
    if (season === undefined || !initialItem.tmdbId) return;
    const controller = new AbortController();
    json<SeasonDetails>(`action=season&id=${initialItem.tmdbId}&season=${season}`, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setEpisodeData({ season, data: result });
      })
      .catch(() => { if (!controller.signal.aborted) setEpisodeError(season); });
    return () => controller.abort();
  }, [initialItem.tmdbId, season]);

  useEffect(() => {
    const controller = new AbortController();
    loadPlayback(initialItem, controller.signal)
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(() => { if (!controller.signal.aborted) setLookupError(true); });
    return () => { controller.abort(); launchRequest.current?.abort(); };
  }, [initialItem]);

  const launch = async (selection: string) => {
    launchRequest.current?.abort();
    const controller = new AbortController();
    launchRequest.current = controller;
    setChecking(true);
    setLookupError(false);
    try {
      const latest = await loadPlayback(initialItem, controller.signal);
      if (controller.signal.aborted) return;
      setOptions(latest);
      if (selection === 'title' ? latest.sources.length : latest.episodes.some(episode => episode.id === selection))
        setPlaying(selection);
    } catch {
      if (!controller.signal.aborted) setLookupError(true);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  const item = data?.item ?? initialItem;
  const currentSeason = data?.seasons.find(entry => entry.number === season);
  const currentEpisodes = episodeData?.season === season ? episodeData?.data : undefined;
  const source = preferredSource(options?.sources ?? [], progress);
  const episodes = (options?.episodes ?? []).map(entry => {
    const metadata = entry.season === season ? currentEpisodes?.episodes.find(e => e.id === entry.id) : undefined;
    return {...entry, title: metadata?.title ?? entry.title, source: preferredSource(entry.sources, progress) ?? entry.source};
  });
  const resume = (id: string) => progress[id]?.position > 0 && !progress[id]?.completed;
  const trailer = data?.videos[0];
  const logo = item.titleLogo;

  return (
    <dialog ref={dialog} className="netflix-detail-modal sf-detail" aria-label={item.title}
      onCancel={event => { event.preventDefault(); if (!playing) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!playing && (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom)) onClose();
      } }}>
      <div inert={Boolean(playing)}>
        <header className="modal-hero-header">
          <Artwork src={item.backdropUrl || item.posterUrl || options?.artwork?.backdrop || options?.artwork?.poster} alt="" className="modal-header-image" loading="eager" />
          <div className="modal-header-shade" />
          <button ref={closeButton} className="modal-close-btn" aria-label="Close details" onClick={onClose}><X size={22} /></button>
          <div className="modal-header-content">
            <h1 className="modal-title">
              {logo && !logoFailed ? <><img className="detail-title-logo" src={logo.url} alt="" onError={() => setLogoFailed(true)} /><span className="card-title-accessible">{item.title}</span></> : item.title}
            </h1>
            <div className="modal-header-actions">
              {source && <button className="btn-billboard btn-play" disabled={checking} onClick={() => void launch('title')}><Play size={18} fill="currentColor" /> {resume(progressKey(source)) ? 'Resume' : source.credit ? 'Watch Now' : 'Play'}</button>}
              {trailer && <a className="btn-billboard btn-mylist" href={trailer.url} target="_blank" rel="noreferrer" aria-label="Watch trailer on YouTube (opens in a new tab)"><Play size={17} /> Trailer</a>}
              <button className="btn-billboard btn-mylist" aria-pressed={inWatchlist} onClick={() => onToggleWatchlist(item)}>{inWatchlist ? <Check size={18} /> : <Plus size={18} />} My List</button>
            </div>
          </div>
        </header>
        <div className="modal-body-container">
          <div>
            <div className="modal-meta-row">
              {item.year > 0 && <span>{item.year}</span>}
              {item.type === 'series' && item.seasons ? <span>{item.seasons} {item.seasons === 1 ? 'season' : 'seasons'}</span> : item.runtime ? <span>{item.runtime} min</span> : item.duration && <span>{item.duration}</span>}
              {item.rating !== undefined && <span className="detail-rating">TMDB {item.rating.toFixed(1)}/10</span>}
            </div>
            <p className="modal-synopsis">{item.overview}</p>
            {source?.credit && <FilmAttribution title={item.title} credit={source.credit} />}
            {lookupError && <p role="status">Could not check playback availability. Try again shortly.</p>}
            {options && !lookupError && !source && episodes.length === 0 && <p className="detail-muted">{item.type === 'movie' ? 'Discover · Full video unavailable on StreamFrame.' : 'Full video unavailable on StreamFrame.'}</p>}
            {error && <p role="alert">Some title details are temporarily unavailable.</p>}
            {!error && !data && initialItem.tmdbId && <p role="status">Loading title details…</p>}
          </div>
          <div className="modal-secondary-details">
            {!!item.cast?.length && <p><strong>Cast:</strong> {item.cast.join(', ')}</p>}
            {!!item.genres.length && <p><strong>Genres:</strong> {item.genres.join(', ')}</p>}
            {item.creator && <p><strong>{item.type === 'series' ? 'Created by' : 'Directed by'}:</strong> {item.creator}</p>}
          </div>
        </div>
        {item.type === 'series' && data && <section className="detail-section" aria-labelledby="detail-episodes">
          <div className="detail-section-heading">
            <h2 id="detail-episodes">Episodes</h2>
            {!!data.seasons.length && <select aria-label="Season" value={season} onChange={event => {
              setEpisodeError(undefined);
              setEpisodeData(undefined);
              setSeason(Number(event.target.value));
            }}>
              {data.seasons.filter(s => s.number > 0).map(s => <option key={s.number} value={s.number}>Season {s.number}{s.name && s.name !== `Season ${s.number}` ? ` · ${s.name}` : ''}</option>)}
              {data.seasons.some(s => s.number === 0) && <optgroup label="Specials"><option value={0}>{data.seasons.find(s => s.number === 0)?.name || 'Specials'} (Season 0)</option></optgroup>}
            </select>}
          </div>
          {currentSeason && <div className="detail-season-summary">
            {(currentEpisodes?.poster || currentSeason.poster) && <Artwork src={currentEpisodes?.poster || currentSeason.poster} alt="" className="detail-season-poster" />}
            <span>{currentSeason.count} {currentSeason.count === 1 ? 'episode' : 'episodes'}</span>
          </div>}
          {season !== undefined && !currentEpisodes && (episodeError === season
            ? <p role="alert">Episodes are temporarily unavailable.</p> : <p role="status">Loading episodes…</p>)}
          {(season === undefined || currentEpisodes?.episodes.length === 0) && <p className="detail-muted">No episodes listed.</p>}
          {currentEpisodes?.episodes.map(episode => {
            const registered = episodes.find(entry => entry.id === episode.id);
            const sourceId = registered ? progressKey(registered.source) : episode.id;
            const saved = progress[sourceId] ?? progress[episode.id];
            return <article className="detail-episode" key={episode.id}>
              <span className="detail-episode-number" aria-label={`Episode ${episode.number}`}>{episode.number}</span>
              <Artwork src={episode.artwork} alt={episode.title} className="episode-artwork" />
              <div className="detail-episode-copy">
                <h3>{episode.title}</h3>
                <p className="detail-muted">{[episode.runtime ? `${episode.runtime} min` : '', episode.airDate].filter(Boolean).join(' · ')}</p>
                {episode.overview && <p>{episode.overview}</p>}
                {saved && <progress aria-label={`Watch progress for ${episode.title}`} value={saved.position} max={saved.duration} />}
                {registered ? <button className="btn-billboard btn-mylist" disabled={checking} onClick={() => void launch(episode.id)}>{resume(sourceId) ? 'Resume' : 'Play'} episode</button>
                  : <small className="detail-muted">Video unavailable</small>}
              </div>
            </article>;
          })}
        </section>}
        <section className="detail-section" aria-labelledby="detail-related">
          <h2 id="detail-related">More Like This</h2>
          {!data && !error && item.tmdbId && <p role="status">Loading related titles…</p>}
          {error && <p className="detail-muted">Related titles are temporarily unavailable.</p>}
          {(!item.tmdbId || (data && !data.similar.length)) && <p className="detail-muted">No related titles listed.</p>}
          <div className="similar-cards-grid">
            {data?.similar.map(related => <a className="similar-card" aria-label={related.title} key={related.id} href={contentPath(related) || '/'}
              onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onSelectSimilar(related);
              }}>
              <div className="similar-thumbnail-wrapper">
                <Artwork src={related.backdropUrl} alt="" className="similar-thumbnail" />
                <CardTitle item={related} />
              </div>
              <div className="similar-info"><p>{related.overview}</p></div>
            </a>)}
          </div>
        </section>
      </div>
      {playing && <VideoPlayer item={item} source={playing === 'title' ? source : undefined}
        sources={options?.sources} recheckSources
        episodes={playing === 'title' ? undefined : episodes} initialEpisodeId={playing === 'title' ? undefined : playing}
        onClose={() => { setPlaying(undefined); void loadPlayback(initialItem).then(setOptions).catch(() => setLookupError(true)); }} />}
    </dialog>
  );
}
