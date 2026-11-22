'use client';



import { canPlay } from '../lib/streaming';

import { Artwork } from './Artwork';

import React, { useEffect, useState } from 'react';

import { X, Play, Plus, Check, ThumbsUp } from 'lucide-react';

import { MediaItem } from '../types/movie';





interface DetailModalProps {

  item: MediaItem;

  inWatchlist: boolean;

  onClose: () => void;

  onPlay: (item: MediaItem) => void;

  onToggleWatchlist: (item: MediaItem) => void;

  onSelectSimilar: (item: MediaItem) => void;

}



export function DetailModal({

  item: initialItem,

  inWatchlist,

  onClose,

  onPlay,

  onToggleWatchlist,

  onSelectSimilar,

}: DetailModalProps) {

  const [item,setItem]=useState(initialItem);

  const [similarItems,setSimilarItems]=useState<MediaItem[]>([]);

  const [videos,setVideos]=useState<{name:string;url:string}[]>([]);

  const [seasons,setSeasons]=useState<{number:number;name:string;count:number}[]>([]);

  const [season,setSeason]=useState(1);

  const [episodes,setEpisodes]=useState<{id:string;number:number;title:string;overview:string;runtime?:number;artwork:string}[]>([]);

  const [loading,setLoading]=useState(false),[error,setError]=useState('');

  const [episodeBusy,setEpisodeBusy]=useState(false),[episodeError,setEpisodeError]=useState('');

  useEffect(()=>{setItem(initialItem);setSimilarItems([]);setVideos([]);setSeasons([]);setEpisodes([]);if(!initialItem.tmdbId)return;const controller=new AbortController();setLoading(true);setError('');fetch(`/api/tmdb?action=details&type=${initialItem.type==='series'?'tv':'movie'}&id=${initialItem.tmdbId}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setItem(d.item);setSimilarItems(d.similar);setVideos(d.videos);setSeasons(d.seasons);setSeason(d.seasons[0]?.number||1);}).catch(()=>{if(!controller.signal.aborted)setError('Details are temporarily unavailable.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[initialItem]);

  useEffect(()=>{if(!initialItem.tmdbId||initialItem.type!=='series'||!seasons.length)return;const controller=new AbortController();setEpisodeBusy(true);setEpisodeError('');setEpisodes([]);fetch(`/api/tmdb?action=season&id=${initialItem.tmdbId}&season=${season}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error();setEpisodes(d.episodes);}).catch(()=>{if(!controller.signal.aborted)setEpisodeError('Episodes are temporarily unavailable.');}).finally(()=>{if(!controller.signal.aborted)setEpisodeBusy(false);});return()=>controller.abort();},[initialItem.tmdbId,initialItem.type,season,seasons]);



  return (

    <div

      className="modal-backdrop-overlay"

      onClick={(e) => {

        if (e.target === e.currentTarget) onClose();

      }}

    >

      <div className="netflix-detail-modal" role="dialog" aria-modal="true" aria-label={item.title}>

        <button

          type="button"

          className="modal-close-btn"

          aria-label="Close"

          onClick={onClose}

        >

          <X size={20} />

        </button>



        <div className="modal-hero-header">

          <Artwork

            src={item.backdropUrl}

            alt={item.title}

            className="modal-header-image"

          />

          <div className="modal-header-shade" />



          <div className="modal-header-content">

            <h2 className="modal-title">{item.title}</h2>

            <div className="modal-header-actions">

              <button

                type="button"

                className="btn-billboard btn-play"

            disabled={!canPlay(item.id)} title={!canPlay(item.id) ? "Video unavailable" : "Play"}

                onClick={() => onPlay(item)}

              >

                <Play size={18} fill="currentColor" />

                <span>Play</span>

              </button>



              <button

                type="button"

                className="card-action-btn icon-circle"

                aria-label="Watchlist"

                onClick={() => onToggleWatchlist(item)}

              >

                {inWatchlist ? <Check size={16} strokeWidth={2.8} /> : <Plus size={18} />}

              </button>



              <button

                type="button"

                className="card-action-btn icon-circle"

                aria-label="Like"

              >

                <ThumbsUp size={15} />

              </button>

            </div>

          </div>

        </div>



        <div className="modal-body-container">

          <div className="modal-primary-details">

            <div className="modal-meta-row">

              <span className="match-score">{item.rating!==undefined?`${item.rating.toFixed(1)} / 10`:`${item.matchScore}% Match`}</span>

              <span className="modal-year">{item.year}</span>

              <span className="card-rating">{item.maturityRating}</span>

              <span className="modal-duration">{item.duration || (item.seasons ? `${item.seasons} Seasons` : '')}</span>





            </div>



            <p className="modal-synopsis">{item.overview}</p>

          </div>



          <div className="modal-secondary-details">

            {item.cast && item.cast.length > 0 && (

              <div className="detail-field">

                <span className="field-label">Cast: </span>

                <span className="field-value">{item.cast.join(', ')}</span>

              </div>

            )}

            <div className="detail-field">

              <span className="field-label">Genres: </span>

              <span className="field-value">{item.genres.join(', ')}</span>

            </div>

            {item.creator && (

              <div className="detail-field">

                <span className="field-label">Creator: </span>

                <span className="field-value">{item.creator}</span>

              </div>

            )}

          </div>

        </div>



        <section style={{padding:'0 32px 24px'}}>

          {loading&&<p role="status">Loading title detailsâ€¦</p>}{error&&<p role="alert">{error}</p>}

          {!canPlay(item.id)&&<p style={{color:'#aaa',marginBottom:16}}>Full video is not available on StreamFrame.</p>}

          {videos.slice(0,2).map(v=><a key={v.url} className="btn-billboard btn-mylist" href={v.url} target="_blank" rel="noreferrer" style={{margin:'0 8px 16px 0'}}>Watch trailer: {v.name}</a>)}

          {seasons.length>0&&<><label>Season <select aria-label="Season" value={season} onChange={e=>setSeason(Number(e.target.value))} style={{background:'#222',color:'white',padding:10}}>{seasons.map(s=><option key={s.number} value={s.number}>{s.name} ({s.count} episodes)</option>)}</select></label>

          {episodeBusy&&<p role="status">Loading episodesâ€¦</p>}{episodeError&&<p role="alert">{episodeError}</p>}

          {episodes.map(e=><article key={e.id} style={{display:'grid',gridTemplateColumns:'minmax(90px,25%) 1fr',gap:16,padding:'20px 0',borderBottom:'1px solid #333'}}><Artwork src={e.artwork} alt={e.title} className="episode-artwork"/><div><h3>{e.number}. {e.title}</h3><p style={{color:'#bbb',margin:'8px 0',lineHeight:1.5}}>{e.overview}</p><small>{e.runtime?`${e.runtime} min · `:''}Video unavailable</small></div></article>)}</>}

        </section>

        {/* More Like This Grid */}

        {similarItems.length > 0 && (

          <div className="modal-more-like-this">

            <h3 className="section-title">More Like This</h3>

            <div className="similar-cards-grid">

              {similarItems.map((sim) => (

                <div

                  key={sim.id}

                  className="similar-card"

                  onClick={() => onSelectSimilar(sim)}

                >

                  <div className="similar-thumbnail-wrapper">

                    <Artwork

                      src={sim.backdropUrl}

                      alt={sim.title}

                      className="similar-thumbnail"

                      loading="lazy"

                    />

                    <div className="similar-duration-tag">

                      {sim.duration || (sim.seasons ? `${sim.seasons}S` : '')}

                    </div>

                  </div>

                  <div className="similar-info">

                    <div className="similar-meta">

                      <span className="match-score">{sim.rating!==undefined?`${sim.rating.toFixed(1)} / 10`:`${sim.matchScore}% Match`}</span>

                      <span className="card-rating">{sim.maturityRating}</span>

                    </div>

                    <h4 className="similar-title">{sim.title}</h4>

                    <p className="similar-overview">{sim.overview}</p>

                  </div>

                </div>

              ))}

            </div>

          </div>

        )}

      </div>

    </div>

  );

}
