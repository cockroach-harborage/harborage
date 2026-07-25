-- Pre-authored inverse of 0022 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
--
-- Dropping this table destroys published accountability records, which are the
-- public product of a multi-person review that cannot be reconstructed from
-- anything the platform holds. Take an export first; the §63 export path exists.
DROP INDEX IF EXISTS idx_acct_incident;
DROP INDEX IF EXISTS idx_acct_status;
DROP INDEX IF EXISTS idx_acct_region;
DROP INDEX IF EXISTS idx_acct_station;
DROP TABLE IF EXISTS accountability_records;
