'use client';

import React, { useState } from 'react';

/** Keep missing art title-specific; never substitute another film's poster. */
export function Artwork({ src, alt, className, loading = 'lazy' }: {
  src?: string; alt: string; className?: string; loading?: 'lazy' | 'eager';
}) {
  const [failedSource, setFailedSource] = useState<string>();
  if (!src || failedSource === src) {
    return <div className={`${className || ''} artwork-fallback`} role="img" aria-label={`${alt}: artwork unavailable`}>
      <span>{alt}</span><small>Artwork unavailable</small>
    </div>;
  }
  const tmdb = src.startsWith('https://image.tmdb.org/t/p/');
  const poster = src.includes('/w500/');
  const sizes = poster ? [342,500,780] : [300,780,1280];
  return <img src={src} srcSet={tmdb?sizes.map(w=>`${src.replace(/\/w\d+\//,`/w${w}/`)} ${w}w`).join(', '):undefined} sizes={tmdb?(poster?'(max-width:600px) 130px, 180px':className==='billboard-image'?'100vw':'(max-width:600px) 68vw, 300px'):undefined} alt={alt} className={className} loading={loading}
    decoding="async" onError={() => setFailedSource(src)} />;
}
