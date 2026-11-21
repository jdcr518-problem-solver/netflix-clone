'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '../components/Navbar';
import { BillboardHero } from '../components/BillboardHero';
import { MovieRow } from '../components/MovieRow';
import { DetailModal } from '../components/DetailModal';
import { VideoPlayer } from '../components/VideoPlayer';
import { SearchDrawer } from '../components/SearchDrawer';
import { MediaItem, CategoryRow } from '../types/movie';
import {
  FEATURED_HERO,
  HOME_PAGE_ROWS,
  ALL_CATALOG_ITEMS,
} from '../lib/catalog';
import { getWatchlist, toggleWatchlist } from '../lib/storage';

export default function Home() {
  const [activeTab, setActiveTab] = useState<string>('home');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const [watchlist, setWatchlist] = useState<number[]>([]);

  // Load persistent watchlist from localStorage
  useEffect(() => {
    setWatchlist(getWatchlist());
  }, []);

  const handleToggleWatchlist = (item: MediaItem) => {
    toggleWatchlist(item.id);
    setWatchlist(getWatchlist());
  };

  const handlePlay = (item: MediaItem) => {
    setPlayingItem(item);
  };

  const handleOpenDetails = (item: MediaItem) => {
    setSelectedItem(item);
  };

  // Filtered titles based on search query or active category tab
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return ALL_CATALOG_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.overview.toLowerCase().includes(q) ||
        item.genres.some((g) => g.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  // Tab-specific views (e.g., TV Shows, Movies, My List, Kids)
  const tabFilteredItems = useMemo(() => {
    if (activeTab === 'home') return [];
    if (activeTab === 'series') {
      return ALL_CATALOG_ITEMS.filter((item) => item.type === 'series');
    }
    if (activeTab === 'movies') {
      return ALL_CATALOG_ITEMS.filter((item) => item.type === 'movie');
    }
    if (activeTab === 'popular') {
      return ALL_CATALOG_ITEMS.filter((item) => item.isTop10 || item.badgeText);
    }
    if (activeTab === 'mylist') {
      return ALL_CATALOG_ITEMS.filter((item) => watchlist.includes(item.id));
    }
    if (activeTab === 'kids') {
      return ALL_CATALOG_ITEMS.filter(
        (item) => item.maturityRating === 'ALL' || item.genres.includes('Kids')
      );
    }
    return [];
  }, [activeTab, watchlist]);

  const rowsToDisplay: CategoryRow[] = useMemo(() => {
    const rows = [...HOME_PAGE_ROWS];
    const mylistItems = ALL_CATALOG_ITEMS.filter((item) => watchlist.includes(item.id));
    if (mylistItems.length > 0) {
      rows.splice(1, 0, {
        id: 'my-list-row',
        title: 'My List',
        type: 'landscape',
        items: mylistItems,
      });
    }
    return rows;
  }, [watchlist]);

  return (
    <main className="streamframe-app">
      {/* Navigation Bar */}
      <Navbar
        currentTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setSearchQuery('');
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Conditional View: Search Results */}
      {searchQuery.trim().length > 0 ? (
        <SearchDrawer
          title={`Results for "${searchQuery}"`}
          items={searchResults}
          watchlist={watchlist}
          onPlay={handlePlay}
          onToggleWatchlist={handleToggleWatchlist}
          onOpenDetails={handleOpenDetails}
        />
      ) : activeTab !== 'home' ? (
        /* Tab Filter View (TV Shows, Movies, My List, etc.) */
        <SearchDrawer
          title={
            activeTab === 'series'
              ? 'TV Shows'
              : activeTab === 'movies'
              ? 'Movies'
              : activeTab === 'popular'
              ? 'New & Popular'
              : activeTab === 'mylist'
              ? 'My List'
              : 'Kids'
          }
          items={tabFilteredItems}
          watchlist={watchlist}
          onPlay={handlePlay}
          onToggleWatchlist={handleToggleWatchlist}
          onOpenDetails={handleOpenDetails}
        />
      ) : (
        /* Default Home Experience matching reference screenshot */
        <>
          <BillboardHero
            item={FEATURED_HERO}
            inWatchlist={watchlist.includes(FEATURED_HERO.id)}
            onPlay={handlePlay}
            onToggleWatchlist={handleToggleWatchlist}
            onOpenDetails={handleOpenDetails}
          />

          <div className="main-content">
            {rowsToDisplay.map((row) => (
              <MovieRow
                key={row.id}
                row={row}
                watchlist={watchlist}
                onPlay={handlePlay}
                onToggleWatchlist={handleToggleWatchlist}
                onOpenDetails={handleOpenDetails}
              />
            ))}
          </div>
        </>
      )}

      {/* Streaming Video Player Overlay */}
      {playingItem && (
        <VideoPlayer
          item={playingItem}
          onClose={() => setPlayingItem(null)}
        />
      )}

      {/* Netflix Detail Modal Overlay */}
      {selectedItem && (
        <DetailModal
          item={selectedItem}
          inWatchlist={watchlist.includes(selectedItem.id)}
          onClose={() => setSelectedItem(null)}
          onPlay={handlePlay}
          onToggleWatchlist={handleToggleWatchlist}
          onSelectSimilar={(sim) => setSelectedItem(sim)}
        />
      )}

      {/* Netflix Style Footer */}
      <footer className="streamframe-footer">
        <div className="footer-top">Questions? Call 1-800-STREAM-FRAME</div>
        <div className="footer-links-grid">
          <a href="#" className="footer-link">Audio Description</a>
          <a href="#" className="footer-link">Help Center</a>
          <a href="#" className="footer-link">Gift Cards</a>
          <a href="#" className="footer-link">Media Center</a>
          <a href="#" className="footer-link">Investor Relations</a>
          <a href="#" className="footer-link">Jobs</a>
          <a href="#" className="footer-link">Terms of Use</a>
          <a href="#" className="footer-link">Privacy</a>
          <a href="#" className="footer-link">Legal Notices</a>
          <a href="#" className="footer-link">Cookie Preferences</a>
          <a href="#" className="footer-link">Corporate Information</a>
          <a href="#" className="footer-link">Contact Us</a>
        </div>
        <button type="button" className="footer-service-btn">Service Code</button>
        <div className="footer-copyright">
          © 2026 StreamFrame, Inc. All movie and TV show artwork for demo purposes.
        </div>
      </footer>
    </main>
  );
}
