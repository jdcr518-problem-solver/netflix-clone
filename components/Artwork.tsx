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
  return <img src={src} alt={alt} className={className} loading={loading}
    decoding="async" onError={() => setFailedSource(src)} />;
}
