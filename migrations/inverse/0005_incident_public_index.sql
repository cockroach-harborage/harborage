-- Pre-authored inverse of 0005 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_ipi_date;
DROP INDEX IF EXISTS idx_ipi_state;
DROP INDEX IF EXISTS idx_ipi_region;
DROP INDEX IF EXISTS idx_ipi_type;
DROP TABLE IF EXISTS incident_public_index;
