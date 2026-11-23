# Production media delivery

Only approved editions enter the playback response. Legacy authorized external MP4/HLS sources retain their host's reviewed controls. Private editions use a stable registry URL of the form `https://objects.streamframe.invalid/<edition digest>/<entry>`. Keep one release and rights window per package. For supplier import, add the reserved origin to the operator's reviewed supplier origins, use the generated locator, list approved audio languages, and supply the existing content-addressed WebVTT files and review evidence. Use public licensed artwork on a real HTTPS origin. TMDB supplies identity and artwork metadata only.

Configure the server and separate Node-compatible gateway with an identical exact HTTPS `STREAMFRAME_DELIVERY_ORIGIN` and independently generated secret of at least 32 random bytes in `STREAMFRAME_DELIVERY_KEY`. Unconfigured protected sources are unavailable. The application checks the current registry row, enablement, distribution, country and time window before signing a path. The player reads from the media host. Relative HLS variant, segment, audio and caption requests retain the signed path. Bearer links can be replayed within their scope and lifetime. Avoid logging signed paths.

At the gateway call `serveMedia(request,config,s3Origin(client,bucket),site,edgeCountry,lookupCurrent)` before **every** cache hit. Supply authenticated edge geography and the current approved registry row keyed by stable source ID (or undefined for a disabled, missing or revoked source). If that feed fails, deny access. Store each package under its digest prefix, deny public bucket access, disable alternate public endpoints, and restrict the gateway identity to reading those objects. Use a separate private ingestion identity. Range requests are forwarded to storage with 206/416 semantics. Limit CORS to the player origin and expose range headers. Cache immutable object bytes by validated object key and range only behind authorization. Viewer responses are private/no-store. Web APIs never carry video bytes.

Grants expire at the earlier of the license deadline and runtime plus 15 minutes. Retry/reopen rechecks the registry. Cached revocation data adds its refresh lag. Without a live revocation feed a previously granted three-hour movie can still play for up to 3h15m, bounded by rights expiry. A response already in flight or bytes already buffered cannot be recalled. Host controls, clock synchronization and revocation propagation require staging verification. Direct external hosts must independently enforce all applicable restrictions.

## Stage a package

Run `npm run media:plan -- PRIVATE_DIRECTORY master.m3u8 12600 captions.vtt` (or pass a feature MP4). The offline plan streams SHA-256 hashes, checks MP4 duration, verifies HLS variant timelines and caption cues, rejects external and missing references, and returns object keys and the entry locator. Use a flat immutable staging directory for one movie edition or episode. Put original approved audio language/label metadata in the supplier manifest. Master playlists can reference alternate audio and subtitle playlists and fMP4 initialization maps. This first adapter supports a restricted clear VOD grammar and a 24 GB limit per object. Other HLS tags require a reviewed extension. Operators must independently validate codecs, tracks, segment decoding, timing and full media rights before publication.

For an approved future transfer, construct the SDK S3Client with an operator-configured endpoint, region and scoped credentials and call `stageEdition(s3Storage(client,bucket),dir,entry,duration,captions)` in a private worker. The adapter uses bounded multipart transfer, immutable keys and checksum metadata, and skips matching objects on retry. The private bucket must support conditional writes and multipart uploads. Keep the stage read-only throughout the operation. Use bucket lifecycle cleanup for abandoned multiparts and validate uploaded bytes with provider checksums or readback before approving a release. Uploading does not touch the registry. Managed hosts with native token schemes can implement the same projection at the server boundary and keep the existing player. CDN-specific signing and transcoding API integrations require an approved provider.

## Provider decision for a free-to-view pilot

USD planning rates checked November 23, 2026. Region, plan, taxes, minimums and included allowances affect actual invoices. Keep the source license, distribution grant, whole-credit requirement and host permission attached to each edition.

| Candidate | Delivery and protection | Pricing and operating implications |
|---|---|---|
| Cloudflare R2 Standard | Private S3 origin, object GET/range, bucket CORS. Use a gateway for country checks and signed HLS paths. Public r2.dev is rate-limited for development. | $0.015/GB-month, $4.50/M writes, $0.36/M reads, zero R2 egress. Add gateway requests/compute and packaging of 720p/1080p. [Pricing](https://developers.cloudflare.com/r2/pricing/) · [Public access](https://developers.cloudflare.com/r2/buckets/public-buckets/) |
| Bunny Stream | Managed video encoding, HLS and optional MP4 fallback. Validate direct player token scope, country controls, MP4 ranges, captions and CORS for the library. | Standard encoding advertised free, storage from $0.01/GB-month, delivery from $0.005/GB, $1 monthly minimum. Region, replication and premium encoding matter. [Stream pricing](https://bunny.net/pricing/stream/) |
| Cloudflare Stream | Managed adaptive delivery up to 1080p, optional downloadable MP4, signed access and country rules. Default upload limit 30 GB. Verify alternate audio and range behavior on actual outputs. | $5 per 1,000 stored minutes/month (capacity increments), $1 per 1,000 delivered minutes, encoding included. [Pricing](https://developers.cloudflare.com/stream/pricing/) · [Access controls](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/) |
| Vercel Blob | Public/private object storage, signed URLs and ranges. HLS needs packaging and protection for every object. Verify independent geography enforcement and plan terms for a public launch. | Example regional rates $0.023/GB-month, $0.05/GB transfer, $0.40/M simple, $5/M advanced. CDN request/origin transfer charges can also apply. External encoding. [Pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) · [Signed URLs](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob) |
| Backblaze B2 | Private S3-compatible origin plus separately authorized CDN. Plan HLS packaging, CORS, range and geo/token checks at the gateway. | $6.95/TB-month, egress up to 3x average storage included then $0.01/GB outside eligible partnerships. A/B/C API calls free on usage pricing, separate Class D schedule. External encoding and CDN costs. [Pricing](https://www.backblaze.com/cloud-storage/pricing) |

Start a budget comparison with **Bunny Stream for unencoded masters**, since encoding and video CDN operations are bundled. For existing quality-checked HLS packages, compare **private R2 plus a gateway** against Bunny in the launch territories. Include the labor and compute for encoding, grant checks and origin operations. Confirm account terms allow the release and expected traffic. No provider has been provisioned or benchmarked. Treat provider-specific upload size/duration caps, CORS, HLS token propagation, precise region rates and fallback formats as acceptance checks before committing a catalog.

## Calculator

`npm run media:cost -- --movies 1000 --movie-hours 3 --seasons 10 --episodes 10 --episode-min 45 --viewers 1000 --hours 3 --mbps 5`

Models decimal GB, 3 Mbps 720p and 5 Mbps 1080p including audio, two stored renditions totaling 8 Mbps, six-second muxed segments. No masters, redundant copies, overhead, retries or separate audio requests included. Default rates model R2 Standard before free allowances and billing-unit rounding. Set `--encode-minute` to an actual external quote (default zero means excluded), and override `--storage --transfer --read-million --write-million --hit-rate` for other offers. Multiply per-event traffic by actual watch time, not library size.

| Library | Both renditions | R2 storage/month before allowances |
|---|---:|---:|
| 100 × 2h / 3h | 720 / 1,080 GB | $10.80 / $16.20 |
| 1,000 × 2h / 3h | 7,200 / 10,800 GB | $108 / $162 |
| 10 seasons × 10 episodes × 45 min | 270 GB | $4.05 |

| Concurrent viewers | Sustained 720p / 1080p | Transfer over 2h | Transfer over 3h |
|---|---|---|---|
| 100 | 300 / 500 Mbps | 270 / 450 GB | 405 / 675 GB |
| 1,000 | 3 / 5 Gbps | 2,700 / 4,500 GB | 4,050 / 6,750 GB |

1,000 viewers for 2h generate roughly 1.2M segment reads. At zero cache hits that models $0.432 in unrounded R2 reads plus gateway work. At the Bunny advertised minimum, 4,500 GB models $22.50 in delivery; Cloudflare Stream models $120 for 120,000 delivered minutes. Include storage separately. All playback/load tests here use local or simulated media. Phase 9C needs approved credentials, a licensed pilot feature and season, real storage and CDN settings, device and long-play sessions, billing limits, and measured startup, seeking, rebuffering and revoke latency.

Cloudflare limits video delivery on its general CDN and directs non-enterprise customers to specific paid services. Confirm the selected R2/gateway configuration is covered before activating it. Bunny requires authorization to distribute copyrighted media. Free viewer access alone does not establish eligibility for a free hosting plan. [Cloudflare CDN service terms](https://www.cloudflare.com/service-specific-terms-application-services/) · [Bunny acceptable use](https://bunny.net/acceptable-use/) · [Vercel Hobby terms](https://vercel.com/docs/plans/hobby)
