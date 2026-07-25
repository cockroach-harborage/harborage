-- Pre-authored inverse of 0009 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_rep_updated;
DROP INDEX IF EXISTS idx_rep_epoch;
DROP INDEX IF EXISTS idx_rep_compartment;
DROP TABLE IF EXISTS reputation_scalars;
