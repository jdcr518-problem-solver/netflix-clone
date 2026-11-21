'use client';

import { canPlay } from '../lib/streaming';
import { Artwork } from './Artwork';
import React, { useState } from 'react';
import { Play, Plus, Check, Volume2, VolumeX } from 'lucide-react';
import { MediaItem } from '../types/movie';

interface BillboardHeroProps {
  item: MediaItem;
  inWatchlist: boolean;
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export function BillboardHero({
  item,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
}: BillboardHeroProps) {
  const [isMuted, setIsMuted] = useState(true);

  return (
    <section className="billboard-container" id="home">
      <div className="billboard-background-wrapper">
        <Artwork
          src={item.backdropUrl}
          alt={item.title}
          className="billboard-image"
          loading="eager"
        />
        <div className="billboard-vignette-left" />
        <div className="billboard-vignette-bottom" />
        <div className="billboard-vignette-top" />
      </div>

      <div className="billboard-content">
        <div className="billboard-eyebrow">
          <span className="series-brandmark">S</span>
          <span className="series-label">SERIES</span>
        </div>

        <div className="billboard-title-wrapper">
          <div className="billboard-title-logo">
            <span className="title-word word-1">
              <span className="cap">S</span>TRANGE<span className="cap">R</span>
            </span>
            <span className="title-word word-2">
              <span className="cap">T</span>HING<span className="cap">S</span>
            </span>
          </div>
        </div>

        <div className="billboard-top10">
          <div className="top10-red-badge">
            <span className="top10-top">TOP</span>
            <span className="top10-num">10</span>
          </div>
          <span className="top10-text">{item.badgeText || '#1 in TV Shows Today'}</span>
        </div>

        <p className="billboard-synopsis">{item.overview}</p>

        <div className="billboard-actions">
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
            className="btn-billboard btn-mylist"
            onClick={() => onToggleWatchlist(item)}
          >
            {inWatchlist ? (
              <>
                <Check size={18} strokeWidth={2.8} />
                <span>My List</span>
              </>
            ) : (
              <>
                <Plus size={20} strokeWidth={2.5} />
                <span>My List</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
