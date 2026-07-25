-- Pre-authored inverse of 0020 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
--
-- Deliberately applicable ON ITS OWN, without 0019's inverse. "Stop publishing
-- capacity" is a crackdown action taken without destroying the registry.
DROP INDEX IF EXISTS idx_bands_built;
DROP INDEX IF EXISTS idx_bands_band;
DROP INDEX IF EXISTS idx_bands_tier;
DROP INDEX IF EXISTS idx_bands_skill;
DROP INDEX IF EXISTS idx_bands_region;
DROP TABLE IF EXISTS capacity_bands;
