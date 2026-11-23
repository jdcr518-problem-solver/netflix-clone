-- Run once as the migration owner. Assign LOGIN credentials out of band.
-- These group roles deliberately have NOLOGIN. Do not use the owner in Next.js.
CREATE ROLE streamframe_reader NOLOGIN;
CREATE ROLE streamframe_operator NOLOGIN;
GRANT USAGE ON SCHEMA streamframe TO streamframe_reader, streamframe_operator;
GRANT SELECT ON streamframe.playback_records TO streamframe_reader;
GRANT SELECT, INSERT, UPDATE ON streamframe.content_refs, streamframe.seasons,
  streamframe.episodes, streamframe.providers, streamframe.sources,
  streamframe.import_checkpoints, streamframe.migration_batches TO streamframe_operator;
GRANT SELECT ON streamframe.license_evidence, streamframe.playback_records TO streamframe_operator;
GRANT SELECT, INSERT ON streamframe.audit_events TO streamframe_operator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA streamframe TO streamframe_operator;
-- No DELETE, schema DDL or audit UPDATE grants. Never grant these to anon,
-- authenticated, PUBLIC, or a browser. Keep streamframe outside Data API schemas.
