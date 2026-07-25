-- Pre-authored inverse of 0013 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_keyrings_bucket;
DROP INDEX IF EXISTS idx_keyrings_tier;
DROP TABLE IF EXISTS evidence_keyrings;
