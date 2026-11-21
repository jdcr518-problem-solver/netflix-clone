'use client';

const WATCHLIST_KEY = 'streamframe_watchlist';
const PROGRESS_KEY = 'streamframe_watch_progress';

export function getWatchlist(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleWatchlist(id: number): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const current = getWatchlist();
    const exists = current.includes(id);
    const updated = exists ? current.filter((item) => item !== id) : [...current, id];
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(updated));
    return !exists;
  } catch {
    return false;
  }
}

export function isInWatchlist(id: number): boolean {
  if (typeof window === 'undefined') return false;
  return getWatchlist().includes(id);
}

export interface WatchProgress {
  id: number;
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export function saveWatchProgress(id: number, currentTime: number, duration: number): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const progressList: WatchProgress[] = raw ? JSON.parse(raw) : [];
    const filtered = progressList.filter((item) => item.id !== id);
    if (currentTime > 5 && currentTime < duration - 10) {
      filtered.unshift({ id, currentTime, duration, updatedAt: Date.now() });
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(filtered.slice(0, 10)));
  } catch {
    // ignore
  }
}

export function getWatchProgressList(): WatchProgress[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
