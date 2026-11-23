import { validateRegistry, type RegistrySource } from './registry-schema.ts';

export class RegistryConflict extends Error {}
export type RegistryCommand = 'approve' | 'approve-package' | 'add' | 'update' | 'remove' | 'enable' | 'disable';

// Shared validation and mutation semantics for both persistent adapters.
export function applyRegistryMutation(current: RegistrySource[], command: RegistryCommand,
  argument: string, patch?: object, expectedVersion?: string): RegistrySource[] {
  const sources = structuredClone(current);
  const now = new Date().toISOString();
  if (command === 'approve-package') {
    if (!Array.isArray(patch) || !patch.length) throw new Error('A reviewed package is required.');
    const approved = validateRegistry({version:1,sources:patch.map(entry=>({...entry,createdAt:now,updatedAt:now}))}, 'tmdb');
    const ids = new Set(sources.map(source=>source.id));
    const urls = new Set(sources.map(source=>source.url));
    for (const entry of approved) {
      if (!entry.supplierRelease) throw new Error('Supplier release evidence is required.');
      if (ids.has(entry.id) || urls.has(entry.url)) throw new RegistryConflict('A package source ID or media URL is already registered.');
      ids.add(entry.id);
      urls.add(entry.url);
    }
    sources.push(...approved);
  } else if (command === 'add' || command === 'approve') {
    const source = {...patch, createdAt:now, updatedAt:now};
    const validated = validateRegistry({version:1,sources:[source]}, 'tmdb')[0];
    if (validated.supplierRelease) throw new Error('Supplier sources must be added through the package importer.');
    if (sources.some(entry=>entry.supplierRelease && entry.url===validated.url)) throw new RegistryConflict('This media URL belongs to a supplier release.');
    if (command === 'approve') {
      const target = validated.target;
      if (!validated.provenance?.releaseReview || target.namespace !== 'tmdb' || target.type !== 'movie') throw new Error('Release review is required.');
      if (validated.provenance.releaseReview.automation && sources.some(entry => entry.url === validated.url))
        throw new RegistryConflict('This exact file already exists in the registry.');
      const index = sources.findIndex(entry => entry.url === validated.url && entry.target.namespace === 'tmdb' &&
        entry.target.type === 'movie' && entry.target.tmdbId === target.tmdbId);
      if (index !== -1) {
        const previous = sources[index];
        if (previous.provenance?.releaseReview) throw new RegistryConflict('This edition already has a release approval.');
        sources[index] = {...validated,id:previous.id,createdAt:previous.createdAt,
          updatedAt:new Date(Math.max(Date.now(),Date.parse(previous.updatedAt)+1)).toISOString()};
      } else sources.push(validated);
    } else sources.push(validated);
  } else {
    const index = sources.findIndex(source => source.id === argument);
    if (index < 0) throw new RegistryConflict('Source no longer exists. Reload the list.');
    const source = sources[index];
    if (expectedVersion !== undefined && source.updatedAt !== expectedVersion) throw new RegistryConflict('This source changed. Reload the list before trying again.');
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(source.updatedAt) + 1)).toISOString();
    if (command === 'remove') sources.splice(index, 1);
    else if (command === 'update') {
      if (patch && 'id' in patch) throw new Error('A source ID cannot change.');
      if (patch && 'target' in patch) throw new Error('A source target cannot change. Add a new source instead.');
      if (patch && ('provenance' in patch || 'supplierRelease' in patch || ((source.provenance || source.supplierRelease) &&
        (['url','format','rightsReference','subtitles'] as const).some(field =>
          field in patch && JSON.stringify((patch as Partial<RegistrySource>)[field]) !== JSON.stringify(source[field]))))) {
        throw new Error('Provider playback and rights fields require a new approval.');
      }
      const merged = {...source, ...patch, updatedAt};
      for (const field of ['label', 'quality', 'subtitles'] as const) {
        if (merged[field] === null) delete merged[field];
      }
      sources[index] = merged;
    } else sources[index] = {...source, enabled:command === 'enable', updatedAt};
  }
  return validateRegistry({version:1,sources}, 'tmdb');
}
