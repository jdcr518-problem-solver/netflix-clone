'use client';

import { canPlay } from '../lib/streaming';
import { Artwork } from './Artwork';
import React from 'react';
import { Play, Plus, Check } from 'lucide-react';
import { MediaItem } from '../types/movie';

interface Top10CardProps {
  item: MediaItem;
  rank: number;
  inWatchlist: boolean;
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export function Top10Card({
  item,
  rank,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
  onOpenDetails,
}: Top10CardProps) {
  return (
    <div className="top10-card" onClick={() => onOpenDetails(item)}>
      <div className="top10-wrapper">
        <div className={`top10-number ${rank>=10?"rank-double":""}`} aria-hidden="true">{rank}</div>

        {/* Overlapping Poster Card */}
        <div className="top10-poster-container">
          <Artwork
            src={item.posterUrl}
            alt={item.title}
            className="top10-poster-image"
            loading="lazy"
          />

          {item.badgeText && (
            <div className="top10-badge-pill">{item.badgeText}</div>
          )}

          <div className="top10-hover-actions">
            <button
              type="button"
              className="card-action-btn play-circle"
                disabled={!canPlay(item.id)} title={!canPlay(item.id) ? "Video unavailable" : "Play"}
              aria-label="Play"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
            >
              <Play size={13} fill="currentColor" />
            </button>
            <button
              type="button"
              className={`card-action-btn icon-circle ${inWatchlist ? 'active' : ''}`}
              aria-label={inWatchlist ? 'Remove from list' : 'Add to list'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatchlist(item);
              }}
            >
              {inWatchlist ? <Check size={13} strokeWidth={2.8} /> : <Plus size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
