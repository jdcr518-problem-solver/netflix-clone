-- Preserve 001's checksum. Replace its case-sensitive extension check, and
-- close gaps for traversal, credentials, whitespace, encoded/query URLs and
-- format/extension mismatches. Scheme stays case-sensitive like mediaUrl().
-- Application WHATWG URL parsing remains required; SQL is defense in depth.
ALTER TABLE streamframe.sources DROP CONSTRAINT sources_media_url_check;
ALTER TABLE streamframe.sources ADD CONSTRAINT sources_media_url_check CHECK (
  length(media_url) <= 2048
  AND media_url ~ '^https://[^/?#@[:space:]]+/[^?#]*$'
  AND media_url !~ '[[:space:]\\?#%]'
  AND media_url !~ '(^|/)\.{1,2}(/|$)'
  AND CASE record->>'format'
    WHEN 'mp4' THEN lower(media_url) ~ '\.mp4$'
    WHEN 'hls' THEN lower(media_url) ~ '\.m3u8$'
    ELSE false
  END
) NOT VALID;
-- Existing valid rows are preserved; invalid legacy SQL-only rows cause the
-- transaction to roll back, without deleting data or marking 002 applied.
ALTER TABLE streamframe.sources VALIDATE CONSTRAINT sources_media_url_check;
