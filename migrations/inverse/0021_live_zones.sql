-- Pre-authored inverse of 0021 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_live_zones_active;
DROP INDEX IF EXISTS idx_live_zones_epoch;
DROP INDEX IF EXISTS idx_live_zones_region;
DROP TABLE IF EXISTS live_zones;
