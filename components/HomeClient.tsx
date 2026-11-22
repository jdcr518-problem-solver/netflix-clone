'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '../components/Navbar';
import { BillboardHero } from '../components/BillboardHero';
import { MovieRow } from '../components/MovieRow';
import { DetailModal } from '../components/DetailModal';
import { VideoPlayer } from '../components/VideoPlayer';
import { SearchDrawer } from '../components/SearchDrawer';
import { MediaItem, CategoryRow } from '../types/movie';
import { ALL_CATALOG_ITEMS as LEGACY_ITEMS } from '../lib/catalog';
import { getWatchlist, toggleWatchlist } from '../lib/storage';

export default function Home({rows,hero,catalogError}:{rows:CategoryRow[];hero:MediaItem|null;catalogError:string|null}) {
  const [savedItems,setSavedItems]=useState<MediaItem[]>([]);
  const HOME_PAGE_ROWS=rows;
  const FEATURED_HERO=hero;
  const ALL_CATALOG_ITEMS=useMemo(()=>[...new Map([...rows.flatMap(r=>r.items),...savedItems].map(i=>[i.id,i])).values()],[rows,savedItems]);
  const [searchResults,setSearchResults]=useState<MediaItem[]>([]);
  const [searchPage,setSearchPage]=useState(1);
  const [totalPages,setTotalPages]=useState(0);
  const [searchBusy,setSearchBusy]=useState(false);
  const [searchError,setSearchError]=useState('');
  const [categoryItems,setCategoryItems]=useState<MediaItem[]>([]);
  const [categoryBusy,setCategoryBusy]=useState(false);
  const [categoryError,setCategoryError]=useState('');
  const [genre,setGenre]=useState('');
  const [genreOptions,setGenreOptions]=useState<{id:number;name:string}[]>([]);

  const [activeTab, setActiveTab] = useState<string>('home');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const [watchlist, setWatchlist] = useState<number[]>([]);

  // Load persistent watchlist from localStorage
  useEffect(() => {
    setWatchlist(getWatchlist());
    try{const stored=JSON.parse(localStorage.getItem('streamframe_saved_metadata')||'[]');const legacy=LEGACY_ITEMS.filter(i=>getWatchlist().includes(i.id));setSavedItems([...new Map([...legacy,...stored].map((i:MediaItem)=>[i.id,i])).values()]);}catch{}
  }, []);

  const handleToggleWatchlist = (item: MediaItem) => {
    toggleWatchlist(item.id);
    setSavedItems(previous=>{const items=[...new Map([...previous,item].map(i=>[i.id,i])).values()];try{localStorage.setItem('streamframe_saved_metadata',JSON.stringify(items));}catch{}return items;});
    setWatchlist(getWatchlist());
  };

  const handlePlay = (item: MediaItem) => {
    setPlayingItem(item);
  };

  const handleOpenDetails = (item: MediaItem) => {
    setSelectedItem(item);
  };

  useEffect(()=>{setSearchPage(1);setSearchResults([]);},[searchQuery]);
  useEffect(()=>{
    if(!searchQuery.trim()){setSearchBusy(false);return;}
    const controller=new AbortController();setSearchBusy(true);setSearchError('');
    const timer=setTimeout(async()=>{try{const r=await fetch(`/api/tmdb?action=search&query=${encodeURIComponent(searchQuery)}&page=${searchPage}`,{signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);setSearchResults(previous=>searchPage===1?data.items:[...new Map([...previous,...data.items].map((i:MediaItem)=>[i.id,i])).values()]);setTotalPages(data.totalPages);}catch(e){if(!controller.signal.aborted)setSearchError('Search is temporarily unavailable. Please try again.');}finally{if(!controller.signal.aborted)setSearchBusy(false);}},350);
    return()=>{clearTimeout(timer);controller.abort();};
  },[searchQuery,searchPage]);
  useEffect(()=>{if(!['series','movies','popular'].includes(activeTab))return;const controller=new AbortController();setCategoryItems([]);setCategoryBusy(true);setCategoryError('');fetch(`/api/tmdb?action=${genre?'discover':'list'}&type=${activeTab==='series'?'tv':'movie'}&category=popular&genre=${genre}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error();return d;}).then(d=>{if(d.items)setCategoryItems(d.items);}).catch(()=>{if(!controller.signal.aborted)setCategoryError('Category is temporarily unavailable. Please try again.');}).finally(()=>{if(!controller.signal.aborted)setCategoryBusy(false);});return()=>controller.abort();},[activeTab,genre]);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/tmdb?action=genres&type=${activeTab==='series'?'tv':'movie'}`,{signal:controller.signal}).then(r=>r.json()).then(d=>{if(Array.isArray(d))setGenreOptions(d);}).catch(()=>{});return()=>controller.abort();},[activeTab]);

  // Tab-specific views (e.g., TV Shows, Movies, My List, Kids)
  const tabFilteredItems = useMemo(() => {
    if (activeTab === 'home') return [];
    if (activeTab === 'series') {
      return categoryItems;
    }
    if (activeTab === 'movies') {
      return categoryItems;
    }
    if (activeTab === 'popular') {
      return categoryItems;
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
  }, [activeTab, watchlist, ALL_CATALOG_ITEMS, categoryItems]);

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
  }, [watchlist, ALL_CATALOG_ITEMS, rows]);

  return (
    <main className="streamframe-app">
      {categoryError&&['series','movies','popular'].includes(activeTab)&&<p role="alert" style={{padding:'90px 4% 0'}}>{categoryError}</p>}
      {/* Navigation Bar */}
      <Navbar
        currentTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setGenre('');
          setSearchQuery('');
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {catalogError&&<p role="status" style={{padding:'80px 4% 0'}}>{catalogError}</p>}
      {searchBusy&&<p role="status" style={{padding:'80px 4% 0'}}>Searching...</p>}
      {searchError&&<p role="alert" style={{padding:'80px 4% 0'}}>{searchError}</p>}
      {/* Conditional View: Search Results */}
      {searchQuery.trim().length > 0 ? (
        <SearchDrawer
          title={`Results for "${searchQuery}"`}
          items={searchResults}
          busy={searchBusy}
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
          filters={['series','movies','popular'].includes(activeTab)?<label style={{display:'block',marginBottom:24}}>Genre <select aria-label="Genre" value={genre} onChange={e=>setGenre(e.target.value)} style={{background:'#222',color:'#fff',padding:8,border:'1px solid #666',borderRadius:4}}><option value="">All genres</option>{genreOptions.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>:undefined}
          items={tabFilteredItems}
          busy={['series','movies','popular'].includes(activeTab)&&categoryBusy}
          watchlist={watchlist}
          onPlay={handlePlay}
          onToggleWatchlist={handleToggleWatchlist}
          onOpenDetails={handleOpenDetails}
        />
      ) : (
        /* Default Home Experience matching reference screenshot */
        <>
          {FEATURED_HERO && <BillboardHero
            item={FEATURED_HERO}
            inWatchlist={watchlist.includes(FEATURED_HERO.id)}
            onPlay={handlePlay}
            onToggleWatchlist={handleToggleWatchlist}
            onOpenDetails={handleOpenDetails}
          />}

          <div className="main-content" style={!FEATURED_HERO?{paddingTop:100}:undefined}>
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

      {searchQuery&&searchPage<totalPages&&!searchError&&<button className="btn-billboard btn-mylist" style={{margin:'0 4% 24px'}} disabled={searchBusy} onClick={()=>setSearchPage(p=>p+1)}>Load more results</button>}
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
          Copyright 2026 StreamFrame, Inc.
          <section aria-label="Credits" style={{marginTop:16}}><a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"><img src="/tmdb-logo.svg" alt="TMDB" width="72" height="52" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><small>Logo by Travis Bell, unchanged, <a href="https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg">via Wikimedia Commons</a> | <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></small></section>
        </div>
      </footer>
    </main>
  );
}
