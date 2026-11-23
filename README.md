# StreamFrame

A Netflix-inspired Next.js/React/TypeScript interface with a custom movie and episode player.

## Run

```sh
npm ci
npm run dev
```

Open http://localhost:3000 for the homepage and http://localhost:3000/player-demo for authorized sample playback.

## Verify

```sh
npx tsc --noEmit
npm run build
npm run start
```

## Features

- Responsive cinematic homepage, landscape cards and ranked portrait posters.
- MP4 and HLS playback, automatic/manual HLS quality, captions, speed, seeking, buffering and retry states.
- Season/episode selection and independent local playback progress.
- Local watchlist and demo Continue Watching.

Catalog metadata and playback authorization are separate. Homepage titles have no registered authorized streams, so their Play buttons are disabled. The demo page explicitly labels its CC0 flower and Big Buck Bunny test streams; it does not play the commercial titles shown on the homepage.

Artwork source URLs and dimensions are recorded in `public/artwork/sources.json`. Publisher hosting is not a grant of commercial reuse rights. External sample streams require internet access. Fullscreen, Picture-in-Picture and audio-track availability depend on browser and source support.

## Live TMDB catalog

Create `.env.local` using `.env.example` and set `TMDB_READ_ACCESS_TOKEN` to your TMDB API read access token. Restart the server after changing it. The token stays on the server; never use a NEXT_PUBLIC variable or commit environment files.

Ten homepage rows, title details, cast, trailers, recommendations, seasons, episodes and debounced paginated search use TMDB API v3. Posters use portrait image sizes and backdrops use landscape sizes. Movie and TV IDs occupy separate stable namespaces. Existing watchlist IDs and playback progress are retained; legacy saved titles remain archived metadata until removed.

Catalog/details cache for one hour, genres for 24 hours, and search for five minutes. Next.js revalidates on requests after expiry, not with a background scheduler; an already-open page needs a reload to see updates. Development-only manual refresh: `Invoke-RestMethod -Method Post http://localhost:3000/api/revalidate`, then reload. Production rejects this endpoint.

Register only licensed sources in `AUTHORIZED_CATALOG_SOURCES` in `lib/streaming.ts`, keyed by `movie:TMDB_ID` or `tv:TMDB_ID`. The registry is empty by default. TMDB supplies metadata and trailer links, not full-movie streaming rights.

TMDB attribution appears in the footer. Review TMDB licensing before commercial deployment. Missing images show a local fallback; unavailable API requests display a safe error without leaking credentials.

TypeScript and production build passed during development. Browser checks covered MP4/HLS playback, captions, quality selection, seeking, episode navigation, resume and error states. Fullscreen/PiP and comprehensive device testing remain pending. The current Next/PostCSS dependency tree has audit findings that should be reviewed before deployment.

Movie/TV landscape cards load original TMDB PNG title logos near the viewport. English logos are preferred, then language-neutral and other-language artwork. Logo metadata is cached server-side for 24 hours and duplicate card requests are shared within a page session. Detail requests append image metadata. Missing or failed logos retain the regular accessible text title; portrait ranking cards retain their poster artwork. Screenshots: visual-review/logos/.
See [Authorized video sources](data/README.md) for the local registry, management commands, and deployment notes.
For scheduled local discovery and policy-based imports, see [Automated import synchronization](data/README.md#automated-import-synchronization).
