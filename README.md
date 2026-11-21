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

The TMDB adapter is preparatory; no TMDB key is required for the local catalog. Never commit secrets or `.env` files.

TypeScript and production build passed during development. Browser checks covered MP4/HLS playback, captions, quality selection, seeking, episode navigation, resume and error states. Fullscreen/PiP and comprehensive device testing remain pending. The current Next/PostCSS dependency tree has audit findings that should be reviewed before deployment.
