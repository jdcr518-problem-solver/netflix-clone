'use client';

import { canPlay } from '../lib/streaming';
import { Artwork } from './Artwork';
import React from 'react';
import { X, Play, Plus, Check, ThumbsUp } from 'lucide-react';
import { MediaItem } from '../types/movie';
import { ALL_CATALOG_ITEMS } from '../lib/catalog';

interface DetailModalProps {
  item: MediaItem;
  inWatchlist: boolean;
  onClose: () => void;
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onSelectSimilar: (item: MediaItem) => void;
}

export function DetailModal({
  item,
  inWatchlist,
  onClose,
  onPlay,
  onToggleWatchlist,
  onSelectSimilar,
}: DetailModalProps) {
  const similarItems = ALL_CATALOG_ITEMS.filter(
    (other) => other.id !== item.id && other.genres.some((g) => item.genres.includes(g))
  ).slice(0, 6);

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
              <span className="match-score">{item.matchScore}% Match</span>
              <span className="modal-year">{item.year}</span>
              <span className="card-rating">{item.maturityRating}</span>
              <span className="modal-duration">{item.duration || `${item.seasons} Seasons`}</span>
              <span className="badge-hd">HD</span>
              <span className="badge-spatial">Spatial Audio</span>
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
                      {sim.duration || `${sim.seasons}S`}
                    </div>
                  </div>
                  <div className="similar-info">
                    <div className="similar-meta">
                      <span className="match-score">{sim.matchScore}% Match</span>
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
