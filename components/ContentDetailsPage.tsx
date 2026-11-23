import { notFound } from 'next/navigation';
import { details } from '../lib/tmdb';
import { DirectDetails } from './DirectDetails';

export async function ContentDetailsPage({ type, id }: { type: 'movie' | 'tv'; id: string }) {
  const number = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(number)) notFound();
  const data = await details(type, number).catch(() => null);
  if (!data) return <main className="detail-route-error"><h1>Title unavailable</h1><p>Check the link or try again later.</p><a href="/">Back to StreamFrame</a></main>;
  return <DirectDetails key={data.item.id} details={data} />;
}
