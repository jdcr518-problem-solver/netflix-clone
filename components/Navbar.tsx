'use client';

import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Navbar({ currentTab, onSelectTab, searchQuery, onSearchChange }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { key: 'home', label: 'Home' },
    { key: 'series', label: 'TV Shows' },
    { key: 'movies', label: 'Movies' },
    { key: 'popular', label: 'New & Popular' },
    { key: 'mylist', label: 'My List' },
  ];

  return (
    <header className={`streamframe-nav ${isScrolled ? 'scrolled' : ''}`}>
      <div className="nav-left">
        <a
          href="#home"
          className="brand-logo"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('home');
          }}
        >
          <span className="brand-text">STREAMFRAME</span>
        </a>

        <nav className="nav-links">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-link ${currentTab === item.key ? 'active' : ''}`}
              onClick={() => onSelectTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="nav-right">
        <div className={`search-container ${searchOpen || searchQuery ? 'open' : ''}`}>
          <button
            type="button"
            className="search-btn"
            aria-label="Search"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={18} strokeWidth={2.4} />
          </button>
          {(searchOpen || searchQuery) && (
            <div className="search-input-wrapper">
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Titles, people, genres"
                className="search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => onSearchChange('')}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`kids-btn ${currentTab === 'kids' ? 'active' : ''}`}
          onClick={() => onSelectTab(currentTab === 'kids' ? 'home' : 'kids')}
        >
          KIDS
        </button>
      </div>
    </header>
  );
}
