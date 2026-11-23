import DemoClient from './DemoClient';
import registry from '../../data/demo-sources.json';
import { toMediaSource, validateRegistry } from '../../lib/registry-schema';
import { unavailable } from '../../lib/streaming';
import type { Episode } from '../../types/playback';

export default function PlayerDemo() {
  const entries = validateRegistry(registry, 'demo').filter(entry => entry.enabled);
  const movie = entries.find(entry => entry.target.namespace === 'demo' && entry.target.type === 'movie' && entry.target.demoId === 'flower');
  const episodes: Episode[] = entries.flatMap(entry => {
    const target = entry.target;
    if (target.namespace !== 'demo' || target.type !== 'episode' || target.demoId !== 'sample-series') return [];
    return [{id:entry.id, season:target.season, number:target.episode, title:entry.label ?? `Episode ${target.episode}`,
      duration:entry.id === 'demo-e1' ? '5 seconds' : undefined, source:toMediaSource(entry)}];
  });
  episodes.push({id:'demo-e3', season:2, number:1, title:'Unavailable episode example', source:unavailable('demo-e3')});
  return <DemoClient movie={movie ? toMediaSource(movie) : unavailable('demo-flower')} episodes={episodes} />;
}
