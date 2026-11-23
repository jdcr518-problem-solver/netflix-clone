# Authorized video sources

The server reads `data/sources.local.json` with schema version 1. This file is ignored by Git and is created on the first successful write. The runtime only reads it. The separate, committed `data/demo-sources.json` powers `/player-demo` and cannot match a TMDB title. A missing local registry is empty. A malformed registry disables catalog playback until corrected.

A source has its own stable ID for playback progress. A movie target uses its TMDB movie ID. An episode target uses its TMDB series ID plus season and episode numbers. Multiple enabled sources may share a target. Playback prefers the source with the most recent unfinished progress, then the first enabled entry. Keep IDs stable for the same video. The CLI keeps IDs and targets immutable.

## Local commands

Use Node.js 22.18 or later. Run from the project root:

```sh
npm run sources -- list
npm run sources -- validate
npm run sources -- add path/to/movie-source.json
npm run sources -- add path/to/episode-source.json
npm run sources -- update movie-main path/to/changes.json
npm run sources -- disable movie-main
npm run sources -- enable movie-main
npm run sources -- remove movie-main
npm run test:sources
```

Updates accept a partial object, for example `{"enabled":false,"label":"1080p master"}`. The CLI writes creation and update timestamps, validates the whole registry, and locks the file during edits. If a terminated process leaves `data/sources.local.json.lock`, verify that no writer is running before removing the stale lock. Back up the local file separately if needed.

Example movie input with placeholders:

```json
{
  "id": "movie-main",
  "target": {"namespace": "tmdb", "type": "movie", "tmdbId": 2147483647},
  "url": "https://media.example.invalid/movies/main.mp4",
  "format": "mp4",
  "label": "1080p master",
  "quality": {"height": 1080},
  "subtitles": [{"id":"en","language":"en","label":"English","url":"https://media.example.invalid/movies/main-en.vtt"}],
  "enabled": false,
  "rightsReference": "Replace with the agreement or license reference for this exact video"
}
```

Example episode input with placeholders:

```json
{
  "id": "episode-s01e01",
  "target": {"namespace": "tmdb", "type": "episode", "tmdbId": 2147483647, "season": 1, "episode": 1},
  "url": "https://media.example.invalid/series/s01e01/index.m3u8",
  "format": "hls",
  "enabled": false,
  "rightsReference": "Replace with the agreement or license reference for this exact episode"
}
```

Use HTTPS browser-playable URLs ending in `.mp4` or `.m3u8`, without query strings, fragments, embedded credentials, or secrets in the path. Captions use HTTPS WebVTT URLs or a flat `/subtitles/name.vtt` path. Hosts must permit playback from the app origin. Validation checks configuration and never contacts a media host. The browser receives enabled playback URLs and subtitle metadata for the requested title, so register only URLs you are authorized to share with viewers. License references and file metadata stay on the server.

The playback endpoint reads the local file on every lookup. The homepage refreshes all availability indicators together on load, on return to the tab, and every 30 seconds while visible. Details recheck the registry on Play or Resume. The player rechecks before switching an episode or source, or retrying. When an item has multiple enabled sources, choose one from the player's Source menu. The app does not revoke streams already playing or URLs already delivered to a browser.

For self-hosted production, provision the registry as a read-only file at `data/sources.local.json` in the app's working directory. Include it explicitly when packaging a standalone build. Serverless disks can be read-only, ephemeral, or isolated per instance. Local edits do not synchronize across deployments or instances. A later phase can introduce authenticated administration with shared persistent storage if needed.

## Local dashboard

Run from the project root:

```sh
npm run dev:admin
```

Open `http://127.0.0.1:4318/admin/sources`. To use another port, run `npm run dev:admin -- 4319`. Stop any other Next development process using the same project build directory first.

The launcher binds to IPv4 loopback and checks the actual socket peer, Host, and forwarded headers before granting access. Mutations additionally require a matching Origin and a JSON request with the admin header. Ordinary `next dev` has no launcher proof, and production routes return 404. Use the CLI if this launcher cannot run. Do not forward or tunnel this port. The dashboard is for trusted users and processes on the same computer.

The table omits video URLs and license references. The authorized edit form shows them locally. Source IDs and content targets are immutable; use a new entry to change either. If another edit wins, reload the list and reopen the form before saving. The JSON file and CLI are shared with the dashboard.

## Importing complete films from providers

Run `npm run dev:admin` and open `http://127.0.0.1:4318/admin/sources`. Use **Provider discovery**, search a title, and choose **Review film**. An empty Blender search lists the curated candidates. Internet Archive search and item details use its documented metadata APIs. Uploader metadata is a claim that requires checking against the rights holder's evidence.

1. Review the original release, the exact file and its edition, the license, and the media host's terms for streaming from StreamFrame. Film rights and hosting permission are separate. Reject a file if either is unclear.
2. Select a TMDB result with the correct title, release year, and credits. Compare the runtime and edition yourself. If no exact match exists, the original provider metadata remains discoverable and the import stays unavailable.
3. Record the owner, evidence link, permitted use, commercial restrictions, and required attribution. Add discovered WebVTT tracks only when their license and language are verified.
4. Explicitly approve the review to write an enabled source to the existing registry. Use Disable to make it unavailable for new play attempts. Imported rights and video fields are locked. A different file or rights record requires a new review. Rejecting a candidate is scoped to the current dashboard session.

Watch Now uses the existing movie cards and direct player. The homepage refreshes it with the existing playback availability checks. Details for movies without playback show Discover and retain available trailers. The browser plays approved media directly from its host without an app proxy.

### Initial review candidates

These are complete shorts. The source URLs were exercised in a disposable local test registry. The project registry requires your explicit release review before any candidate is added.

| Film | TMDB ID | Playback verification | Publisher evidence |
| --- | --- | --- | --- |
| Big Buck Bunny (2008) | 10378 | Mux HLS, 10:34. The test rendition runtime differs from the TMDB record. Confirm the edition and intact credits. | [Blender Peach attribution terms](https://peach.blender.org/about/) |
| Sintel (2010) | 45745 | Internet Archive MP4, 14:48, including a mobile viewport check. | [Durian CC BY 3.0 and credit requirements](https://durian.blender.org/sharing/) |
| Tears of Steel (2012) | 133701 | Internet Archive MP4, 12:14, played and sought. Unified Streaming HLS started and later stalled during seeking. | [Blender Foundation release](https://www.youtube.com/watch?v=OHOpb2fS-cM) |

The tested editions did not have verified WebVTT captions. Tears of Steel's [Xiph mirror](https://media.xiph.org/tearsofsteel/subtitles/) lists translated SRT files. Check the rights and language of each track before converting and attaching it. The player supports existing WebVTT tracks and HLS subtitle renditions when supplied by a reviewed stream.

## Phase 7A release review

Movie playback and Watch Now now require an enabled source with a complete release review, including publisher evidence, named license and link, hosting evidence and notes, the verified credits check, and the passed playback check for that specific edition. Provider imports from before this review and manually entered movies remain pending. Reapprove the same file through Provider discovery to retain its existing source ID and progress. TV episode sources and the demo registry continue to use their existing authorization workflow.

The three candidates remain pending in the project registry:

| Exact candidate | Match and evidence | Release blocker |
| --- | --- | --- |
| [Big Buck Bunny, Mux HLS](https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8), 10:34 | TMDB 10378, Sacha Goedegebure, [Peach CC BY 3.0](https://peach.blender.org/about/). Keep the release credits and Blender Foundation attribution. | Confirm the longer test rendition against the original, verify the complete required credit sequence, and confirm public playback from the demo host. |
| [Sintel, Archive stereo MP4](https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4), 14:48 | TMDB 45745, Colin Levy, [Durian CC BY 3.0](https://durian.blender.org/sharing/). Keep the complete credit scroll. | Verify the complete required credits in this exact mirror and confirm the host's public playback terms. |
| [Tears of Steel, Archive 720p MP4](https://archive.org/download/Tears-of-Steel/tears_of_steel_720p.mp4), 12:14 | TMDB 133701, Ian Hubert, [Mango publisher information](https://mango.blender.org/about/) and [Blender release](https://www.youtube.com/watch?v=OHOpb2fS-cM). Keep the credits and Blender Foundation attribution. | Confirm the exact license reference, credits, and public hosting terms. The [Unified Streaming HLS rendition](https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8) is a separate review and failed a late seek in browser QA. |

### Manual device checks before release

On desktop Chrome or Firefox, play a reviewed edition, enter fullscreen, exit with Escape and the player button, then close the player and confirm focus returns to details. On a physical iPhone in Safari and Android phone in Chrome, repeat playback inline and in fullscreen, rotate both ways, tap to reveal controls, drag and release the seek bar, adjust volume where the OS supports it, and return to details. Test a late seek, resume after leaving the page, and the MP4 fallback on a reviewed pair of sources. Check captions and audio only on editions that actually supply those tracks. Responsive browser viewport testing is not a substitute for testing these native device behaviors.

## Automated import synchronization

Use Node.js 22.18 or later. From the project root, run `npm run sources:sync` for a scheduled run or `npm run sources:sync -- --now` for an immediate run. The private dashboard also has **Run Sync Now**. The default policy discovers Blender Open Movies and the Internet Archive `opensource_movies` collection. Discovery scopes do not grant publication rights. The default contains zero preauthorizations.

To schedule locally, configure Windows Task Scheduler to run `npm.cmd run sources:sync` hourly with the StreamFrame directory as **Start in**, and disallow overlapping instances. An equivalent cron job can run the command from the project root on another host. No scheduler or background worker is installed. The `minimumIntervalMinutes` setting defaults to 60, and `--now` bypasses that interval. The job checks one bounded page per feed, tracks its page and position, and rotates the starting feed. It skips recently reviewed candidates and records new identifiers across feeds. At the end of a feed, it returns to the start on the next run to pick up changes. Archive listing uses [Advanced Search](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html) and the [Item Metadata API](https://archive.org/developers/md-read.html).

A run budgets 40 seconds for upstream work. It checkpoints after each candidate and stores up to 350 candidate records and 20 recent runs. Registry publication still uses the existing locked atomic writer. If a hard process kill leaves `data/import-state.local.json.lock`, read its PID and verify the process is gone before removing that lock. Keep the checkpoint file. The next run marks the previous one interrupted and checks the registry for duplicates before attempting another write.

### Defining authorization

Copy `data/import-policy.example.json` to `data/import-policy.local.json` and add rules after verifying the grant. Rules can use `review`, `deny`, or `preauthorize`. Denial wins, then manual review. Review and deny rules may use `"*"` as publisher within a named collection. Preauthorization requires the exact provider, collection, named publisher, public browser origin and distribution grant, conditions, attribution, expiry, and an edition list drawn from that grant. Do not enter a collector's claim as publisher evidence. Each listed edition needs the exact public URL, known credits, title, director, release year, runtime in seconds, expected TMDB ID, and recorded browser playback evidence. The importer rejects ambiguous TMDB matches.

A preauthorization rule has this shape. The values below are fictional and do not authorize any film.

```json
{
  "id": "example-fictional-catalog",
  "action": "preauthorize",
  "provider": "blender",
  "collection": "blender-open-movies",
  "publisher": "Fictional publisher for illustration",
  "distribution": "public-browser-direct",
  "playbackOrigin": "https://player.example.invalid",
  "evidenceUrl": "https://example.invalid/publisher-grant",
  "hostingEvidenceUrl": "https://example.invalid/host-grant",
  "licenseName": "Example agreement",
  "licenseUrl": "https://example.invalid/license",
  "permittedUse": "Describe the grant for free in-browser public viewing",
  "hostingNotes": "Describe authorized direct playback and host limits",
  "restrictions": "Describe applicable scope and restrictions",
  "attribution": "Exact attribution from the agreement",
  "validUntil": "2099-01-01T00:00:00.000Z",
  "editions": [
    {
      "candidateId": "fictional-item",
      "url": "https://download.blender.org/demo/movies/fictional.mp4",
      "format": "mp4",
      "tmdbId": 42,
      "title": "Fictional item",
      "year": 2020,
      "director": "Fictional director",
      "durationSeconds": 120,
      "creditsVerified": true,
      "browserPlaybackEvidenceUrl": "https://example.invalid/edition-browser-test",
      "modificationNotice": "No modifications"
    }
  ]
}
```

Optional edition `subtitles` contain `id`, `label`, `language`, `url`, and `evidenceUrl` per track. The track must already appear on the provider with that URL and language and pass WebVTT/CORS checks. Audio options come from the player, so the importer does not assign audio languages.

The media check refuses redirects, enforces fixed host and path rules, and reads only small byte ranges or manifests. It checks AVC MP4 metadata and seek ranges or clear MPEG-TS HLS VOD variants and representative segments. It rejects unsupported HLS variants, encrypted or segmented configurations outside that subset, and durations it cannot verify. Standard Archive download redirects can therefore require manual review. Passing a probe is not proof of actual playback. Use the browser evidence field to record edition-specific QA under the proposed playback conditions.

Existing file URLs are never republished or re-enabled. An automatic release record stores its policy ID, hash, expiry, and evidence. Expired policy approvals stop appearing in new playback lookups. For a revoked grant, disable the corresponding registry sources immediately and update the local policy. Changing the policy does not revoke URLs previously supplied to browsers. A future production scheduler would need an explicitly authorized registry writer and shared durable storage. This local command and the monitoring API are disabled in production.

### Blender Open Movies on an authorized origin

The private review lists exact publisher releases separately from legacy QA streams. Blender's film pages document CC BY 3.0 and require full closing credits. None of the download hosts below is configured as a StreamFrame playback origin. Download access and byte-range support do not document permission to use a host for public player traffic.

| Film | TMDB identity | Publisher release | Required attribution |
| --- | --- | --- | --- |
| Big Buck Bunny | 10378 · 2008 · Sacha Goedegebure | [Peach 320×180 MP4 ZIP](https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4.zip) or [Sunflower 1080p 30 fps ZIP](https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip). Treat the remaster as a separate edition. | © 2008 Blender Foundation / www.bigbuckbunny.org ([Peach terms](https://peach.blender.org/about/)) |
| Sintel | 45745 · 2010 · Colin Levy | [Durian second-render 1080p MKV](https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv) | © Blender Foundation / durian.blender.org ([Durian terms](https://durian.blender.org/sharing/)) |
| Tears of Steel | 133701 · 2012 · Ian Hubert | [Mango first-render 1080p WebM on the publisher-linked Xiph mirror](https://media.xiph.org/tearsofsteel/tears_of_steel_1080p.webm) | © Blender Foundation / mango.blender.org ([Mango terms](https://mango.blender.org/about/)) |

First staging candidate is the unmodified Peach 320×180 MP4 extracted from the publisher ZIP. The file is 64,657,027 bytes, runs 596.459 seconds, and has SHA-256 `f78f39603e6774907f2faafabf26a667f4a6fc31769ec304a8a8f7c62d280508`. Loopback browser QA confirmed start, seeking, credit frames, and post-credit footage. This review sampled the closing sequence. It is pending full credit review and authorized-origin playback evidence.

For each film approved for hosting on infrastructure you control, use a separate `preauthorize` rule in the local policy. Start with the example fields above and make these changes once you have actual host and browser evidence:

1. Use `provider: "blender"`, `collection: "blender-open-movies"`, `publisher: "Blender Foundation"`, and `distribution: "owned-same-origin"`. Record the film-specific publisher terms, attribution and conditions, CC BY 3.0 license URL, host permission to serve public video, and a review expiry. Choose the exact HTTPS origin of the application as `playbackOrigin`.
2. Stage an AVC MP4 from one listed publisher edition. Unpack, remux or encode as needed and document the change. Compare the entire opening and closing sequence with the master, including the end of the credit roll and any post-credit material. Set `creditsVerified` only after checking the actual output. Use the measured runtime in seconds and confirm that it satisfies the existing TMDB match. Record `ownedMasterUrl` as the exact publisher download and `mediaSha256` as the lowercase SHA-256 of the final MP4 (`Get-FileHash -Algorithm SHA256` in PowerShell).
3. Name the final MP4 `<candidateId>-<mediaSha256>.mp4`. Keep a read-only verification copy in `data/owned-media/` on the importer machine. Configure your approved host to serve those exact bytes at `/streamframe-media/<candidateId>-<mediaSha256>.mp4` with `video/mp4` and HTTPS byte ranges. `url` is the absolute same-origin URL. The local staging directory stays private and Git-ignored. StreamFrame does not mount it as a web directory or proxy it. This mode currently supports MP4 without separate subtitle tracks.
4. Record the actual served edition's hash and `206` byte-range behavior, browser start and seek, saved resume, attribution, mobile playback and error recovery in `browserPlaybackEvidenceUrl`. Keep that evidence separate from the copyright license. The importer checks local bytes and media metadata before publication. It relies on the recorded QA for actual host playback and does not send requests to the configured origin.
5. Run `npm run sources:sync -- --now` and verify the actual release is listed under Watch Now. If a host grant or edition check is missing, leave the film pending. Use the existing registry controls to disable an edition when its hosting permission changes.

## Phase 8 supplier packages

The operator-only package command writes to the same source registry as the catalog importer and private admin. It verifies TMDB identities, validates the package and all staged assets, and writes the full package atomically. Source IDs are stable per supplier and supplied source ID. Importing a duplicate ID or media URL fails without writing any part of the package. Use the existing admin or source CLI to disable or remove a release. Replacing immutable media or renewing rights requires a newly reviewed package. Reviewers can prepare the next edition under a new source ID and URL before disabling the existing one.

```powershell
$env:STREAMFRAME_SUPPLIER_MEDIA_ORIGINS = 'https://media.example.invalid,https://art.example.invalid'
npm run sources:package -- path/to/reviewed-package.json
npm run sources:package -- path/to/reviewed-package.json --publish
```

The first command after setting origins is a dry run. The `--publish` command records sources in the local registry. Viewer availability is still evaluated on every playback lookup. The environment setting can also go in `.env.local`. Configure only reviewed asset origins. The importer makes TMDB identity requests and reads local assets. It does not fetch or proxy supplier URLs. The `SupplierFeed` interface accepts a future supplier adapter that emits the same package document.

### Manifest version 1

Use `version`, `supplierId`, `packageId`, `rights`, and a `titles` array. Supply a separate package when rights differ. The following fictional package illustrates the structure and is for documentation only.

```json
{
  "version": 1,
  "supplierId": "fictional-studio",
  "packageId": "edition-01",
  "rights": {
    "licenseName": "Example distribution agreement",
    "licenseUrl": "https://media.example.invalid/evidence/license",
    "holder": "Fictional Studio",
    "attribution": "© Fictional Studio",
    "attributionUrl": "https://media.example.invalid/films",
    "distribution": "free-on-demand",
    "territories": ["IN", "PK"],
    "startsAt": "2030-01-01T00:00:00.000Z",
    "expiresAt": "2031-01-01T00:00:00.000Z",
    "hostingEvidenceUrl": "https://media.example.invalid/evidence/edge-controls",
    "hostEnforcement": "dates-and-territories"
  },
  "titles": [{
    "type": "movie", "tmdbId": 123, "title": "Example Film", "year": 2025,
    "durationSeconds": 10800,
    "artwork": {"poster": "https://art.example.invalid/edition-01.jpg"},
    "sources": [{
      "id": "film-hls-v1", "format": "hls", "url": "https://media.example.invalid/edition-01/master.m3u8",
      "audio": [{"language": "en", "label": "English"}, {"language": "hi", "label": "Hindi"}],
      "review": {
        "evidenceUrl": "https://media.example.invalid/evidence/playback-and-tracks",
        "playbackPassed": true, "seekPassed": true, "resumePassed": true,
        "creditsVerified": true, "hostControlsVerified": true, "trackSelectionPassed": true
      }
    }]
  }]
}
```

- For `type: "tv"`, give the TMDB series ID, title, premiere year, and `seasons` with `number`, `complete`, and `episodes`. Each episode has `number`, `tmdbEpisodeId`, `title`, `year`, `durationSeconds`, and its own `sources` in the format above. Season zero is valid for specials. `complete: true` requires every TMDB episode in that season. Set `complete: false` for individual episodes or partial seasons. Next Episode stops when the next expected episode is unavailable. Existing TMDB episode layouts are reused. Legacy episode entries without supplier approval remain visible to operators and are excluded from public playback.
- A source may set `enabled: false` or supply a `label`. IDs are unique across the supplier's packages. A source can provide external media with documented verification, a staged MP4, or a staged HLS media playlist for timing verification. For a staged MP4, use `staged: {file, sha256}` and place `<id>-<sha256>.mp4` in `data/owned-media/`. Its served URL must end with that filename. The size cap is 24 GB. For HLS, stage `<sha256>.m3u8` in `data/supplier-assets/` and supply the same `staged` fields. That copy is one complete media variant used for an offline duration check. Review the actual served master, renditions, segments, and alternate audio for every HLS release.
- `subtitles` holds `{id, language, label, url, staged: {file, sha256}}` objects. Put each reviewed UTF-8 WebVTT file at `data/supplier-assets/<sha256>.vtt` and serve it at a URL ending with the same filename. Cue ordering, bounds, and timing are validated against the edition. Use the language tags actually present, such as `en`, `hi`, and `ur`. Use reviewed sidecar WebVTT for package subtitles. Declare every licensed audio rendition and verify labels and language tags from the actual stream. HLS audio selection uses tracks reported by the player. Native audio selection depends on whether the browser exposes its track API. [WebVTT format](https://www.w3.org/TR/webvtt1/)
- Keep review records for the exact media URL and edition, release rights for all bits including tracks and art, playback start, a seek deep into the title, resume after refresh, track selection, expected completion, and interruption/failover. The review booleans are the operator's record of those results. The importer validates the staging evidence but cannot verify contracts or browser results from an evidence link.

### Delivery and access control

- Serve media directly from an authorized HTTPS host. For MP4, test `Range` requests at the start and late in the file and verify `206 Partial Content` with a correct `Content-Range`. Use browser-compatible AVC/AAC and put the MP4 metadata near the start when packaging. MP4s with cross-origin captions need CORS. Cross-origin HLS needs CORS on the master, renditions, init files, segments, alternate audio, and associated assets. Use a complete VOD playlist with `#EXT-X-ENDLIST` and test quality switching in the target browsers. [HTTP range requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests) · [HLS](https://www.rfc-editor.org/rfc/rfc8216.html)
- The media host must enforce the license window on every request and apply any territorial restrictions to the media and associated assets, including cached copies served by a CDN. Configure the app's trusted edge to strip any incoming `x-streamframe-country` and `x-streamframe-geo-key`, determine the country itself, and inject those headers on the edge-to-origin leg. Set `STREAMFRAME_GEO_PROXY_SECRET` to the same server-only random value of at least 32 characters. Keep the app origin private behind that edge and keep these headers out of responses and logs. Unknown or unauthenticated country data fails closed for restricted assets. `territories: "worldwide"` uses `hostEnforcement: "dates"`. `paid-on-demand` records future rights and stays unavailable in this release. Media-edge enforcement is required because clients can copy asset URLs from playback responses.
- Use immutable versioned URLs and verify served bytes match the reviewed copy. The local storage adapter supports direct HTTPS URLs. A future signed-URL adapter should issue short-lived grants after a fresh rights check, cap expiry at the license end, and cover HLS child requests. This version does not mint tokens or store signed URLs or secrets in the registry.
- Estimate decimal GB as `combined Mbps × duration in seconds ÷ 8000`. A 90–180 minute film at 3–6 Mbps uses roughly 2.0–8.1 GB per complete play. At 180 minutes, an HLS ladder totaling 10 Mbps uses about 13.5 GB of video storage before separate audio, overhead, and masters. Playback bandwidth uses the selected renditions, with additional traffic for seeks, retries, and repeat viewing.
- Production needs a durable validated registry, an approved media host, and a trusted edge before any restricted release. Provision the registry as server-side data and use a controlled publication process to update it. The current local importer is disabled in production. Provider-specific feed credentials and signed delivery can be integrated when a supplier and host are selected.
