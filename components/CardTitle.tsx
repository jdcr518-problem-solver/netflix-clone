'use client';

import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../types/movie';

type Logo = MediaItem['titleLogo'];
// Repeated titles across carousels share one request for this page session.
const requests = new Map<string, Promise<Logo>>();
function loadLogo(key: string): Promise<Logo> {
  let request = requests.get(key);
  if (!request) {
    request = fetch(`/api/tmdb?action=logo&${key}`)
      .then(async response => {
        if (!response.ok) throw new Error('Logo unavailable');
        return (await response.json()).logo as Logo;
      }).catch(() => null);
    requests.set(key, request);
  }
  return request;
}

export function CardTitle({ item }: { item: MediaItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [logo, setLogo] = useState<Logo>(item.titleLogo);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLogo(item.titleLogo);
    setFailed(false);
    if (item.titleLogo !== undefined || !item.tmdbId || !ref.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      loadLogo(`type=${item.type === 'series' ? 'tv' : 'movie'}&id=${item.tmdbId}`)
        .then(value => { if (active) setLogo(value); });
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [item.tmdbId, item.type, item.titleLogo]);

  return <div ref={ref} className={`card-title-label${logo && !failed ? ' has-title-logo' : ''}`}>
    {logo && !failed ? <>
      <img className="card-title-logo" src={logo.url} width={logo.width} height={logo.height}
        alt="" aria-hidden="true" decoding="async" onError={() => setFailed(true)} />
      <span className="card-title-accessible">{item.title}</span>
    </> : item.title}
  </div>;
}
