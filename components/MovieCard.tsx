'use client';

import { canPlay } from '../lib/streaming';
import { Artwork } from './Artwork';
import React from 'react';
import { Play, Plus, Check, ChevronDown, ThumbsUp } from 'lucide-react';
import { MediaItem } from '../types/movie';

interface MovieCardProps {
  item: MediaItem;
  inWatchlist: boolean;
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export function MovieCard({
  item,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
  onOpenDetails,
}: MovieCardProps) {
  return (
    <div className="movie-card" onClick={() => onOpenDetails(item)}>
      <div className="movie-card-media">
        <Artwork
          src={item.backdropUrl}
          alt={item.title}
          className="movie-card-image"
          loading="lazy"
        />

        <div className="card-title-label">{item.title}</div>

        {item.isOriginal && (
          <span className="card-brandmark" title="StreamFrame Original">
            S
          </span>
        )}

        <div className="card-hover-overlay">
          <div className="card-actions-row">
            <div className="actions-left">
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
                <Play size={14} fill="currentColor" />
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
                {inWatchlist ? <Check size={14} strokeWidth={2.8} /> : <Plus size={16} />}
              </button>

              <button
                type="button"
                className="card-action-btn icon-circle"
                aria-label="Like"
                onClick={(e) => e.stopPropagation()}
              >
                <ThumbsUp size={13} />
              </button>
            </div>

            <button
              type="button"
              className="card-action-btn icon-circle expand-btn"
              aria-label="More Info"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails(item);
              }}
            >
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="card-info-meta">
            <span className="match-score">{item.matchScore}% Match</span>
            <span className="card-rating">{item.maturityRating}</span>
            <span className="card-duration">{item.duration || `${item.seasons} Seasons`}</span>
            <span className="badge-hd">HD</span>
          </div>

          <div className="card-genres">
            {item.genres.slice(0, 3).map((genre, idx) => (
              <span key={genre} className="genre-pill">
                {idx > 0 && <span className="genre-dot">•</span>}
                {genre}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
