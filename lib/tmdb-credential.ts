import 'server-only';
import {createHash} from 'node:crypto';

// One-way fingerprint of the retired high-entropy credential. Keep it denied across rotations.
const retiredFingerprint='323fd79d2093cb507351d4fcc96930965e947174ca122c09dc945475c454abd0';

export function catalogToken(env:Partial<NodeJS.ProcessEnv>=process.env) {
  const token=env.TMDB_READ_ACCESS_TOKEN;
  if(!token || /\s/.test(token)) throw new Error('Catalog is not configured.');
  if(env.NODE_ENV==='production') {
    const fingerprint=createHash('sha256').update(token).digest('hex');
    if(fingerprint===retiredFingerprint || fingerprint!==env.STREAMFRAME_TMDB_APPROVED_SHA256)
      throw new Error('Production catalog credential has not passed rotation verification.');
  }
  return token;
}
