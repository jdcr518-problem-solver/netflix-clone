-- PostgreSQL 15+. No extensions, provider APIs, credentials, or viewer identities.
CREATE SCHEMA IF NOT EXISTS streamframe;
REVOKE ALL ON SCHEMA streamframe FROM PUBLIC;

CREATE TABLE streamframe.content_refs (
  kind text NOT NULL CHECK (kind IN ('movie','series')),
  tmdb_id bigint NOT NULL CHECK (tmdb_id > 0),
  PRIMARY KEY (kind, tmdb_id)
);
CREATE TABLE streamframe.seasons (
  kind text NOT NULL DEFAULT 'series' CHECK (kind = 'series'),
  tmdb_id bigint NOT NULL,
  season integer NOT NULL CHECK (season >= 0),
  PRIMARY KEY (kind, tmdb_id, season),
  FOREIGN KEY (kind, tmdb_id) REFERENCES streamframe.content_refs
);
CREATE TABLE streamframe.episodes (
  kind text NOT NULL DEFAULT 'series' CHECK (kind = 'series'),
  tmdb_id bigint NOT NULL,
  season integer NOT NULL,
  episode integer NOT NULL CHECK (episode > 0),
  tmdb_episode_id bigint CHECK (tmdb_episode_id > 0),
  PRIMARY KEY (kind, tmdb_id, season, episode),
  FOREIGN KEY (kind, tmdb_id, season) REFERENCES streamframe.seasons
);
CREATE TABLE streamframe.providers (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100)
);

-- The version-1 record remains canonical. Generated indexed columns cannot drift
-- from the validated document; licensing, tracks, credits and evidence live once.
CREATE TABLE streamframe.sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'),
  record jsonb NOT NULL,
  kind text GENERATED ALWAYS AS (CASE record #>> '{target,type}' WHEN 'movie' THEN 'movie' ELSE 'series' END) STORED,
  tmdb_id bigint GENERATED ALWAYS AS ((record #>> '{target,tmdbId}')::bigint) STORED NOT NULL,
  season integer GENERATED ALWAYS AS ((record #>> '{target,season}')::integer) STORED,
  episode integer GENERATED ALWAYS AS ((record #>> '{target,episode}')::integer) STORED,
  provider_id text GENERATED ALWAYS AS (coalesce('supplier:' || (record #>> '{supplierRelease,supplierId}'), record #>> '{provenance,provider}', 'manual')) STORED,
  media_url text GENERATED ALWAYS AS (record ->> 'url') STORED NOT NULL,
  enabled boolean GENERATED ALWAYS AS ((record ->> 'enabled')::boolean) STORED NOT NULL,
  approval text GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(record->'supplierRelease') = 'object'
    OR (record #>> '{provenance,status}' = 'approved' AND jsonb_typeof(record #> '{provenance,releaseReview}') = 'object')
    THEN 'approved' ELSE 'pending' END) STORED,
  revoked_at timestamptz,
  revocation_reason text CHECK (length(revocation_reason) BETWEEN 1 AND 500),
  CHECK (record->>'id' = id AND record #>> '{target,namespace}' = 'tmdb'),
  CHECK (record ?& ARRAY['id','target','url','format','enabled','rightsReference','createdAt','updatedAt']),
  CHECK (jsonb_typeof(record->'target')='object' AND (record->'target') ?& ARRAY['namespace','type','tmdbId']),
  CHECK (record #>> '{target,type}' IN ('movie','episode')),
  CHECK ((kind='movie' AND season IS NULL AND episode IS NULL) OR (kind='series' AND season>=0 AND episode>0)),
  CHECK (record->>'format' IN ('mp4','hls')),
  CHECK (media_url ~ '^https://[^/?#@ ]+/[^?# ]+\.(mp4|m3u8)$'),
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CHECK ((record->>'createdAt')::timestamptz <= (record->>'updatedAt')::timestamptz),
  CHECK (record #> '{supplierRelease,rights}' IS NULL OR
    ((record #>> '{supplierRelease,rights,startsAt}')::timestamptz < (record #>> '{supplierRelease,rights,expiresAt}')::timestamptz)),
  FOREIGN KEY (kind, tmdb_id) REFERENCES streamframe.content_refs,
  FOREIGN KEY (kind, tmdb_id, season, episode) REFERENCES streamframe.episodes,
  FOREIGN KEY (provider_id) REFERENCES streamframe.providers
);
CREATE INDEX source_target ON streamframe.sources (kind,tmdb_id,season,episode);
CREATE INDEX source_url ON streamframe.sources (media_url);

CREATE FUNCTION streamframe.protect_source_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id <> NEW.id OR OLD.record->'target' <> NEW.record->'target'
    OR OLD.record->'createdAt' <> NEW.record->'createdAt' THEN
    RAISE EXCEPTION 'Source identity and creation timestamp are immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Revoked sources are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_source BEFORE UPDATE ON streamframe.sources
  FOR EACH ROW EXECUTE FUNCTION streamframe.protect_source_identity();

CREATE TABLE streamframe.import_checkpoints (
  id text PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE TABLE streamframe.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 120),
  action text NOT NULL,
  source_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE streamframe.migration_batches (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rolled_back_at timestamptz,
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources)='array')
);

-- Server-side reader only. The application revalidates records and enforces
-- territory/time rights before an allowlisted PlaybackOptions projection.
-- This view is NOT a public HTTP/Data API and must never be exposed as one.
CREATE VIEW streamframe.playback_records AS
  SELECT record, kind, tmdb_id FROM streamframe.sources
  WHERE enabled AND approval='approved' AND revoked_at IS NULL;
CREATE VIEW streamframe.license_evidence AS
  SELECT id, provider_id, approval, revoked_at,
    record->>'rightsReference' AS rights_reference,
    record->'provenance' AS publisher_evidence,
    record->'supplierRelease' AS supplier_evidence
  FROM streamframe.sources;

REVOKE ALL ON ALL TABLES IN SCHEMA streamframe FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA streamframe FROM PUBLIC;
