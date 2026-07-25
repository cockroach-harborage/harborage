-- Pre-authored inverse of 0011 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_corr_epoch;
DROP INDEX IF EXISTS idx_corr_bucket;
DROP INDEX IF EXISTS idx_corr_entity;
DROP INDEX IF EXISTS idx_corr_entity_token;
DROP TABLE IF EXISTS corroborations;
