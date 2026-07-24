-- Pre-authored inverse of 0002 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_incidents_date;
DROP INDEX IF EXISTS idx_incidents_status;
DROP INDEX IF EXISTS idx_incidents_state;
DROP INDEX IF EXISTS idx_incidents_geo;
DROP INDEX IF EXISTS idx_incidents_region;
DROP INDEX IF EXISTS idx_incidents_type;
DROP TABLE IF EXISTS incidents;
