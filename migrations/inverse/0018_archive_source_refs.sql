-- Pre-authored inverse of 0018 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_srcref_seen;
DROP INDEX IF EXISTS idx_srcref_state;
DROP INDEX IF EXISTS idx_srcref_band3;
DROP INDEX IF EXISTS idx_srcref_band2;
DROP INDEX IF EXISTS idx_srcref_band1;
DROP INDEX IF EXISTS idx_srcref_band0;
DROP TABLE IF EXISTS archive_source_refs;
