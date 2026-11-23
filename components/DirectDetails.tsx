'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TitleDetails } from '../types/details';
import { getWatchlist, toggleWatchlist } from '../lib/storage';
import { contentPath } from '../lib/content-path';
import { DetailModal } from './DetailModal';

export function DirectDetails({ details }: { details: TitleDetails }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(getWatchlist().includes(details.item.id)), [details.item.id]);
  return <DetailModal item={details.item} details={details} inWatchlist={saved}
    onClose={() => router.push('/')}
    onSelectSimilar={item => { const path = contentPath(item); if (path) router.push(path); }}
    onToggleWatchlist={item => {
      const added = toggleWatchlist(item.id);
      setSaved(getWatchlist().includes(item.id));
      if (!added) return;
      try {
        const entries = JSON.parse(localStorage.getItem('streamframe_saved_metadata') || '[]');
        const records = Array.isArray(entries) ? entries : [];
        localStorage.setItem('streamframe_saved_metadata', JSON.stringify([...records.filter(entry => entry?.id !== item.id), item]));
      } catch { /* The watchlist remains saved if metadata storage fails. */ }
    }} />;
}
