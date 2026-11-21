'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CategoryRow, MediaItem } from '../types/movie';
import { MovieCard } from './MovieCard';
import { Top10Card } from './Top10Card';

interface MovieRowProps {
  row: CategoryRow;
  watchlist: number[];
  onPlay: (item: MediaItem) => void;
  onToggleWatchlist: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export function MovieRow({
  row,
  watchlist,
  onPlay,
  onToggleWatchlist,
  onOpenDetails,
}: MovieRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    const track = scrollRef.current;
    if (!track) return;
    const observer = new ResizeObserver(checkScroll);
    observer.observe(track);
    checkScroll();
    return () => observer.disconnect();
  }, [row.items]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const distance = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
    setTimeout(checkScroll, 350);
  };

  return (
    <section className="movie-row-section" id={row.id}>
      <h2 className="row-title">
        <span className="row-title-text">{row.title}</span>
        <span className="row-explore-arrow">
          Explore All <ChevronRight size={14} />
        </span>
      </h2>

      <div className="row-slider-container">
        {canScrollLeft && (
          <button
            type="button"
            className="row-nav-arrow arrow-left"
            aria-label="Previous titles"
            onClick={() => handleScroll('left')}
          >
            <ChevronLeft size={30} strokeWidth={2.5} />
          </button>
        )}

        <div
          ref={scrollRef}
          className={`row-items-track ${row.type === 'top10' ? 'top10-track' : 'landscape-track'}`}
          onScroll={checkScroll}
          tabIndex={0}
          aria-label={row.title}
        >
          {row.items.map((item, index) => {
            const inWatchlist = watchlist.includes(item.id);
            if (row.type === 'top10') {
              return (
                <Top10Card
                  key={item.id}
                  item={item}
                  rank={item.rank || index + 1}
                  inWatchlist={inWatchlist}
                  onPlay={onPlay}
                  onToggleWatchlist={onToggleWatchlist}
                  onOpenDetails={onOpenDetails}
                />
              );
            }
            return (
              <MovieCard
                key={item.id}
                item={item}
                inWatchlist={inWatchlist}
                onPlay={onPlay}
                onToggleWatchlist={onToggleWatchlist}
                onOpenDetails={onOpenDetails}
              />
            );
          })}
        </div>

        {canScrollRight && (
          <button
            type="button"
            className="row-nav-arrow arrow-right"
            aria-label="Next titles"
            onClick={() => handleScroll('right')}
          >
            <ChevronRight size={30} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </section>
  );
}
