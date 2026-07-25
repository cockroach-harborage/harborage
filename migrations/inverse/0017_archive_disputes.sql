-- Pre-authored inverse of 0017 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_disp_raised;
DROP INDEX IF EXISTS idx_disp_supersedes;
DROP INDEX IF EXISTS idx_disp_reason;
DROP INDEX IF EXISTS idx_disp_stance;
DROP INDEX IF EXISTS idx_disp_outcome;
DROP INDEX IF EXISTS idx_disp_item;
DROP TABLE IF EXISTS archive_disputes;
