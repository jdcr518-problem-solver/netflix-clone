import { timingSafeEqual } from 'node:crypto';

export interface PackageRights {
  licenseUrl: string;
  licenseName: string;
  holder: string;
  attribution: string;
  attributionUrl: string;
  distribution: 'free-on-demand' | 'paid-on-demand';
  territories: 'worldwide' | string[];
  startsAt: string;
  expiresAt: string;
  hostingEvidenceUrl: string;
  hostEnforcement: 'dates' | 'dates-and-territories';
}

const countryCode = /^[A-Z]{2}$/;

export function permitsPlayback(rights: PackageRights, country?: string, now = Date.now()) {
  return rights.distribution === 'free-on-demand' && now >= Date.parse(rights.startsAt) &&
    now < Date.parse(rights.expiresAt) && (rights.territories === 'worldwide' ||
      (rights.hostEnforcement === 'dates-and-territories' && !!country && rights.territories.includes(country)));
}

export function trustedCountry(headers: Headers, secret = process.env.STREAMFRAME_GEO_PROXY_SECRET) {
  const supplied = headers.get('x-streamframe-geo-key');
  const country = headers.get('x-streamframe-country');
  if (!secret || secret.length < 32 || !supplied || !country || !countryCode.test(country) || ['XX','ZZ'].includes(country)) return;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return country;
}
