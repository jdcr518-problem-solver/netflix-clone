# Private staging readiness

## Runtime placement

| Runtime | Proposed host | Boundary to verify |
|---|---|---|
| Next.js UI and catalog/playback APIs | Protected Vercel project, Node runtime | Stateless HTTP, reader-only database, server-only TMDB token, no video proxy. Protect every staging alias before enabling Git integration. Keep the public viewer flow anonymous. |
| PostgreSQL | Separate Neon staging project or existing PostgreSQL 15+ service | Registry, audit, durable checkpoints and revocations. Keep schema outside public data APIs. |
| Media gateway | Private Node service behind the approved CDN | Mount the existing Fetch-compatible createProductionGateway().handle on /v1/* before cache lookup. The listener/host adapter, streaming backpressure, disconnect cancellation, long GETs and shutdown require provider integration. |
| Operator worker | Existing private runner with fixed commands | Short-lived MFA access token, role-specific database login, private evidence and local input manifests. Schema migrations run with a separately injected migrator credential. |
| Scheduled worker | Isolated job on the private runner | Fresh workload JWT per invocation, bounded retries, direct PostgreSQL session, immutable policy and reviewed package/evidence mounts. |
| Storage and CDN | Private S3-compatible origin plus approved video delivery service | Immutable edition objects, read-only gateway identity, separate controlled ingestion identity, no public bucket URL. |

The workers may share hardware under separate OS identities. Media planning and multipart ingestion need stable local files and can outlast an HTTP request. Local JSON administration needs locks, atomic writes and a persistent directory. Keep these workloads outside Vercel functions. The scheduler's PostgreSQL session lock spans multiple transactions. Use a direct connection for it and migrations. A transaction pool can serve short web reads after TLS and privilege checks pass. Budget up to three database connections per active application pool, multiplied by service instances. [Neon pooling](https://neon.com/docs/connect/connection-pooling)

## Configuration and private diagnostics

From the repository root, generate one blank template for each runtime. Replace the stage argument with production to generate the corresponding production template. Roles are web, gateway, scheduler, operator and migrator. The template command reads no live secret values. Keep completed templates outside Git. Use distinct secrets, origins and databases for each environment. Both stages require production-mode checks.

~~~sh
npm run --silent readiness -- template gateway staging
npm run --silent readiness -- template web production
npm run readiness -- config gateway
npm run readiness -- probe gateway
~~~

Inject each role's approved environment privately before running config or probe. Config checks the existing runtime contract and verifies worker signatures, scope and policy digest as applicable. Package validation additionally requires the reviewed supplier origins and local package assets. The operator's sync and package commands require the corresponding policy or TMDB secrets. Generate independent random delivery and geo keys with at least 32 bytes of entropy. Share delivery keys only between web and gateway and inject the geo proof only from a trusted proxy. CORS must match the exact HTTPS player origin.

Probe is a private CLI with aggregate pass/fail output. It connects to PostgreSQL over verified TLS. Web also checks the configured HTTPS player origin, demo, playback response and hidden admin route. Run inside the staging access boundary. Gateway checks its in-process unsigned request denial; externally check the listener and actual S3 permissions separately. Scheduler checks its last completed checkpoint, zero playback failures and a completion within 24 hours. A new scheduler requires an initial approved run before this check turns green. Operator and migrator probes validate their identity and connectivity. Check supervisor process exit, job heartbeat and restart count separately. No public health endpoint is needed.

## Staging database and credential gates

1. After approval, select the database region near the application, separate staging credentials and the restore window. Take a private logical backup before schema changes.
2. Run authenticated `npm run sources:database -- schema` against the direct migration connection. Review pending names and checksums, then apply with `--apply`. Re-run dry-run and expect zero pending migrations. The ledger rejects changed applied files and transactional failures roll back.
3. Apply db/roles.sql once as the owner, grant its group roles to separate least-privilege logins, and inject only the matching URL into each service. Use verified TLS and sslmode=verify-full where specified. Keep administrative owner credentials off the web and gateway.
4. Restore the backup into a disposable staging database, re-establish roles, compare source counts, evidence, revocations and checkpoints, and repeat a reader lookup. Migration-batch rollback handles reviewed imported records; it does not reverse schema migrations. For schema recovery use a verified restore or forward correction. Reconcile revocations made since the backup before enabling playback.
5. Have the TMDB account owner obtain a replacement through API settings or private support, revoke the previous credential, privately compute and approve the new SHA-256 fingerprint and inject token and pin together. Verify a successful metadata call and provider rejection of the retired credential. Record status and secret version only. Test that removing or mismatching the pin blocks production access. [Rotation runbook](phase9c-operations.md#tmdb-application-token-rotation)

## Provider acceptance and licensed-device pilot

- **Synthetic baseline.** Run typecheck, npm test, native PostgreSQL tests, npm audit, production build and credential scan. Exercise the private probes with disposable credentials. Keep a clean database snapshot.
- **Browser smoke.** In a protected staging session, check anonymous browsing, artwork, unavailable titles, demo playback and disabled admin routes on desktop, iOS Safari and Android Chrome. Record browser/OS version, startup time, seeking and errors.
- **Actual host.** Confirm written permission for the exact edition, credits, audio, captions, territories, dates and delivery method. Check storage policy with anonymous GET and HEAD against all direct and alternate origin URLs. Require denial. Strip client-supplied geo headers and inject authenticated country information at web and gateway. Test allowed, denied and unknown territories. Accept MP4 range 206 with exact bytes, valid HLS master/variant/audio/caption playback and denial for expired or wrong-edition grants. Prime a cache, revoke the source, then retry the same range, playlist, segment and subtitle. Require denial before any cache hit. Rotate the signing key in both services and verify old links fail and newly issued links play. Confirm CDN and proxy logs redact signed paths.
- **Full-length verification.** With separate upload approval, play one approved film through final credits on each target device. Interrupt network, seek near the end, resume, switch tracks and verify credit display. Measure rebuffering and revocation on the next request. Later repeat with two authorized episodes and confirm season/episode identity, independent progress and next-episode selection. Record exact edition digest and results. Provider and device gates require their own evidence.

## Pilot costs, controls and rollback

Proposed monthly pilot limits are one film, 8 GB stored, ten two-hour viewing sessions and 50 GB delivered. At 5 Mbps those sessions consume about 45 GB before overhead. Use an existing private runner and eligible Vercel/Neon free quotas first. Neon Free lists 100 CU-hours per project per month; frequent probes and per-segment queries can keep compute awake. R2 Standard includes 10 GB-month, 1M writes and 10M reads monthly with free R2 egress. Under these assumptions incremental storage and database charges can be $0. Gateway hosting, gateway egress, CDN, encoding, backups, DNS and log retention require their own quotes. Bunny Stream lists a $1 monthly minimum. Confirm service terms for video and staging protection before choosing any plan. [Vercel Hobby](https://vercel.com/docs/plans/hobby) · [Neon pricing](https://neon.com/pricing) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Cloudflare CDN terms](https://www.cloudflare.com/service-specific-terms-application-services/) · [Bunny Stream](https://bunny.net/pricing/stream/)

Set provider alerts at 50% and 80% of the pilot allowances. Install a CDN rate limit on media requests and a separate limit on grant issuance. Calibrate bursts with actual player parallelism and seeks, then verify legitimate playback and a controlled 429 response. Keep short-lived counters and discard IPs from application logs. Track bytes served, object operations, gateway 403/5xx, DB compute/connections, storage inventory, rights expiry and job failures. Confirm who receives a test alert. At the cap, suspend delivery at the edge and pause import jobs; billing alerts alone do not enforce a cap.

For an incident, disable or revoke the edition in the responder worker, test the prior URL, and withdraw any legacy external stream with its host. If the scope is uncertain, close the gateway, stop jobs, rotate affected credentials, purge caches and restore a known-good application revision. Preserve the new TMDB pin and all revocation tombstones across rollback. Reopen after the negative playback, rights and origin-isolation checks pass and the owner approves.
