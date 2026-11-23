# Phase 9A: persistent source registry

Phase 9A implements storage and operator tooling. It does not deploy StreamFrame,
create cloud accounts, authorize new films, or introduce viewer accounts or payments.
The player, UI, watchlist, demo registry, and saved progress identities are unchanged.

## Architecture

`RegistryStore` is the storage boundary. The JSON adapter delegates to the existing
validated, locked, atomic file writer. PostgreSQL uses `pg` and ordinary PostgreSQL
15+ SQL, without a provider SDK or ORM. Both adapters share `registry-schema.ts` and
`registry-mutation.ts`; playback still uses the existing rights checks and public
`PlaybackOptions` projection.

| Storage | Purpose |
| --- | --- |
| `content_refs` | Movie or series TMDB identity, without duplicating catalog metadata |
| `seasons`, `episodes` | Exact series/season/episode coordinates and optional TMDB episode ID |
| `providers` | Publisher or supplier identifier |
| `sources` | Canonical validated source record; indexed generated target, URL, provider, enabled and approval fields; revocation tombstone |
| `license_evidence` | Private view of existing publisher/supplier evidence, rights windows, territories and approval |
| `playback_records` | Approved, enabled, nonrevoked records for the trusted application reader |
| `import_checkpoints` | Durable cursors, review outcomes, run history, revisions and expiring worker leases |
| `audit_events` | Actor, action, source ID, timestamp and before/after hashes; append-only operator grants |
| `migration_batches` | Imported IDs and hashes, enabling conflict-aware rollback |
| `schema_migrations` | Applied schema version and checksum |

The existing JSON source document is canonical within the database. Rights,
attribution, subtitles, audio tracks and evidence are stored once inside it; generated
columns and foreign keys prevent drift in indexed mappings. A pending record has
no complete release approval and is never playable. Expired or territorially blocked
records remain retained, but the application refuses playback. Revocation is a
separate permanent tombstone: re-enabling or retrying an import cannot restore it.

Short transactions protect publication, source changes, audit insertion and batch
migration. A transaction advisory lock serializes operator source writes, including
the duplicate check. This is intentionally conservative for the current registry;
partition write locking if import volume eventually warrants it. Database CHECK,
NOT NULL, primary/foreign keys and immutable identity/revocation triggers add
protection beneath application validation.

Targeted playback reads use the movie/series identity index. Availability remains
fresh on each API request; there is no stale authorization cache. Revocation stops
new playback lookups. It cannot invalidate an already delivered external media URL;
CDN access control remains a later release prerequisite.

## Explicit runtime configuration

Development defaults to the existing JSON workflow when the mode is unset, and
`.env.example` explicitly selects `json`. Production requires
`STREAMFRAME_REGISTRY_MODE=postgres` and a valid read connection. JSON mode is
rejected in production. A missing/unreachable database produces unavailable
catalog playback and a generic server diagnostic, never a local file fallback.
The separate demo player remains available without a database.

| Variable | Where it belongs |
| --- | --- |
| `STREAMFRAME_REGISTRY_MODE` | Web and operator runtimes: `json` locally or `postgres` |
| `STREAMFRAME_DATABASE_READ_URL` | Server-side web runtime; login granted `streamframe_reader` only |
| `STREAMFRAME_DATABASE_WRITE_URL` | Private operator job only; login granted `streamframe_operator` |
| `STREAMFRAME_DATABASE_MIGRATION_URL` | Private schema migration job only; schema owner |
| `STREAMFRAME_OPERATOR_ID` | Required stable operator/job identity for database mutations |
| `STREAMFRAME_DATABASE_CA` | Optional provider CA PEM for TLS verification |
| `STREAMFRAME_DATABASE_LOCAL_INSECURE=1` | Loopback development PostgreSQL only; rejected in production |
| `STREAMFRAME_TEST_DATABASE_URL` | Optional disposable loopback test database, named `streamframe_test_*` |

Use the deployment secret store; never use `NEXT_PUBLIC_` or commit connection
strings. Do not put the write or owner URL in the web deployment. The driver verifies
TLS certificates and hostnames; connection URLs accept only an optional
`sslmode=verify-full` parameter, so provider URLs containing other SSL options must
be adapted. Each process has a small pool (maximum three connections), connection,
statement and idle-transaction timeouts. Pool sizing still requires load testing.

`db/roles.sql` is a separately reviewed, one-time group-role provisioning script.
The group roles are NOLOGIN; provision distinct login credentials and grant group
membership privately. The web reader gets only the playback view; operators cannot
delete sources, alter the schema or rewrite audit events. Run the schema migration
first. Do not make either role a superuser, table owner or member of the owner role.
The owner can override these controls and must remain restricted to migrations.

`playback_records` contains server-side authorization evidence needed by the
existing validator. It is **not an anonymous Data API**. Keep the whole `streamframe`
schema out of Supabase/PostgREST/GraphQL exposure, and never distribute its reader
credential to browsers. Anonymous HTTP responses contain only the existing
allowlisted public player fields and attribution, never internal evidence,
hosting/playback review notes, checkpoint state or audit data. Geography and license
windows are checked after reading and before this projection.

The current admin dashboard remains local JSON-only and is hidden in database mode
and production. Phase 9A adds no public write routes and no production admin login.

## Schema and content migration

From the application directory, configure the required private URLs and operator ID:

```sh
npm run sources:database -- schema
npm run sources:database -- schema --apply
# Privately provision role grants using db/roles.sql.
npm run sources:database -- migrate-json
npm run sources:database -- migrate-json --apply
```

Both schema and content migration default to dry-run. Schema files are checksum
checked (with normalized line endings) and applied transactionally. Never edit an
already applied migration: add a new numbered migration and extend the runner for
the next schema revision. Roles are provisioned separately because hosted providers
differ in role-creation permissions.

Content migration reads only the validated `data/sources.local.json` file, or an
explicit JSON file argument. It does not traverse staging directories or migrate
environment files, policy secrets, video bytes, or local paths. It rejects detected
embedded credentials and signed evidence URLs. Only records with an existing
complete release approval are eligible; pending/unlicensed records are skipped.
Disabled status, stable IDs, timestamps, evidence and rights are preserved.
Time/territory restrictions remain enforced; migration does not grant approvals.

Dry-run reports additions, unchanged records, skipped records, and conflicting IDs.
An apply with any conflict writes nothing. Exact retries make no duplicate sources
or audit events. Different payloads or reused media URLs require operator review;
the utility never overwrites existing database sources. The local JSON is untouched.
Source IDs alone are not proof that two editions are equal.

```sh
npm run sources:database -- rollback-import BATCH_HASH
npm run sources:database -- rollback-import BATCH_HASH --apply
```

Rollback revokes only records inserted by that batch, retaining their evidence and
audit trail. If a source has since changed, the entire rollback reports conflicts
and writes nothing. Preexisting sources are untouched. Revoked IDs cannot be
resurrected by replaying a batch. No destructive schema down-migration is provided.

Before a real migration, take an encrypted PostgreSQL backup outside the repository
using `pg_dump` and a private `PGSERVICE`/`PGPASSFILE`, not a password in command-line
arguments. Back up roles/grants separately. Test `pg_restore` into a new isolated
database, validate sources and rights, compare source counts/IDs, and smoke-test
playback before switching connection secrets. Keep the old database for rollback.
After restore, reconcile every revocation made after the snapshot **before serving
traffic**. Prefer forward corrective migrations; never restore over a live database
or clear revocations to make an import succeed.

## Operator commands and import compatibility

The original `npm run sources` commands continue to manage JSON. When explicitly
in database mode they direct the operator to the new private CLI:

```sh
npm run sources:database -- list
npm run sources:database -- validate
npm run sources:database -- add draft.json --apply
npm run sources:database -- update SOURCE_ID patch.json --apply
npm run sources:database -- disable SOURCE_ID --apply
npm run sources:database -- enable SOURCE_ID --apply
npm run sources:database -- revoke SOURCE_ID "Rights withdrawn" --apply
npm run sources:database -- checkpoint publisher-sync
```

`add`/`update` cannot set approval evidence; use the existing reviewed package or
policy workflow. `remove` in database mode is a retained revocation, not physical
deletion. IDs and targets cannot be edited. There is no automatic unrevocation.

The existing commands select the configured store:

```sh
npm run sources:package -- reviewed-manifest.json
npm run sources:package -- reviewed-manifest.json --publish
npm run sources:sync
npm run sources:sync -- --now
```

Supplier package verification still runs before any write. Database publication
commits the entire package or nothing. An exact retry preserves an operator's
disabled status; a changed or revoked edition raises a conflict. JSON duplicate
behavior remains unchanged. Complete season and exact TMDB episode checks are reused.

Publisher synchronization keeps policies, identity matching and authorized media
probes unchanged. Database mode uses a 90-second renewable lease, short transactions
and durable checkpoints instead of local lock files. Publication and the next cursor
commit together. An expired worker's transaction is fenced off; crashes resume from
the last committed checkpoint. Network discovery/probes occur outside transactions.
Supplier manifests themselves are atomic retry units and need no discovery cursor.

Private policy/staged-asset input remains operator-controlled. A future job runner
must supply it securely. No scheduler, public sync endpoint, arbitrary proxy,
automatic Internet Archive approval or network host expansion was added.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

The database tests use isolated PGlite PostgreSQL/WASM databases for real SQL,
constraints, role grants, transactions, migration rollback, rights enforcement and
import workflows. PGlite is a test-only dependency, not production storage.
The optional native-driver test requires an empty local PostgreSQL database named
`streamframe_test_*`, checks that it is unused, and verifies competing writes and
transaction rollback using `pg`. It never clears an existing schema or connects
to a remote test target. Without its environment variable it is explicitly skipped.
TLS, provider transaction-pooler behavior and regional failover require a future
approved staging environment even when local tests pass.

## Future hosting decision (no services activated)

| Option | Fit | Decision to make before launch |
| --- | --- | --- |
| Neon PostgreSQL | Recommended first candidate for a small Next.js registry; pooled connections without requiring a viewer authentication product | Confirm current free-plan limits, database region, restore retention, wake-up latency and permitted use |
| Supabase PostgreSQL | Compatible SQL and useful database tooling; its Auth and Storage products are optional | Keep private schema outside its Data API, configure role grants, use the serverless transaction pooler and verify backup availability |
| Managed PostgreSQL / existing operator-hosted PostgreSQL | Full compatibility with ordinary `pg`, predictable control of roles and backups | Operator owns patching, network/TLS configuration, monitoring, recovery and sufficient connection capacity |

Use a Vercel **Node.js** runtime or another managed Node host, with a pooled database
endpoint close to the app. This adapter does not target the Edge runtime. Use a
direct owner connection only for migrations and an operator worker for long media
validation; do not put long supplier imports in a web request. Migrations do not run
automatically during Next.js build or app startup. No session advisory locks or
named prepared statements are used, allowing transaction pooling.

Do not treat a free database tier as free full-length video delivery. Keep authorized
movie/episode assets outside PostgreSQL and the Next.js filesystem, on separately
approved storage/CDN. Region/date enforcement must also protect playlists, segments
and captions at the media host. No media is uploaded by this phase.

Official references reviewed for this design:

- [node-postgres transactions](https://node-postgres.com/features/transactions)
- [node-postgres TLS](https://node-postgres.com/features/ssl)
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon plans](https://neon.com/docs/introduction/plans)
- [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js)
- [PGlite test engine](https://pglite.dev/docs/about)

Public release still requires an approved database/hosting choice and budget,
least-privilege login provisioning, restore drills, provider TLS/pooler verification,
production operator authentication, trustworthy geography, licensed media and CDN
enforcement, job scheduling, monitoring, dependency security review and load tests.
The initial service remains free to viewers, with no signup or subscription.
