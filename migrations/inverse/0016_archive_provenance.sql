-- Pre-authored inverse of 0016 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_prov_recorded;
DROP INDEX IF EXISTS idx_prov_poster;
DROP INDEX IF EXISTS idx_prov_root;
DROP INDEX IF EXISTS idx_prov_band;
DROP INDEX IF EXISTS idx_prov_assertion;
DROP TABLE IF EXISTS archive_provenance;
