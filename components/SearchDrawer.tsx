'use client';

import React from 'react';
import { MediaItem } from '../types/movie';
import { MovieCard } from './MovieCard';

interface SearchDrawerProps {
  title: string;
  busy?: boolean;
  filters?: React.ReactNode;
  items: MediaItem[];
  watchlist: number[];
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export function SearchDrawer({
  title,
  busy = false,
  filters,
  items,
  watchlist,
  onPlay,
  onToggleWatchlist,
  onOpenDetails,
}: SearchDrawerProps) {
  return (
    <section className="search-results-section">
      {filters}
      <div className="search-section-header">
        <h2 className="search-title">{title}</h2>
        <span className="results-count">{busy ? 'Loadingâ€¦' : `${items.length} titles found`}</span>
      </div>

      {busy && items.length === 0 ? <p role="status">Loading titlesâ€¦</p> : items.length === 0 ? (
        <div className="search-empty-state">
          <p>Your search did not have any matches.</p>
          <p className="empty-subtext">Suggestions: Try different keywords, genres, or check your spelling.</p>
        </div>
      ) : (
        <div className="search-results-grid">
          {items.map((item) => (
            <MovieCard
              key={item.id}
              item={item}
              inWatchlist={watchlist.includes(item.id)}
              onPlay={onPlay}
              onToggleWatchlist={onToggleWatchlist}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </div>
      )}
    </section>
  );
}
