-- Pre-authored inverse of 0014 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_phash_seen;
DROP INDEX IF EXISTS idx_phash_band3;
DROP INDEX IF EXISTS idx_phash_band2;
DROP INDEX IF EXISTS idx_phash_band1;
DROP INDEX IF EXISTS idx_phash_band0;
DROP TABLE IF EXISTS perceptual_hashes;
