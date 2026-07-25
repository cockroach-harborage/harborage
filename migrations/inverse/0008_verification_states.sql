-- Pre-authored inverse of 0008 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_vs_directive;
DROP INDEX IF EXISTS idx_vs_updated;
DROP INDEX IF EXISTS idx_vs_kind;
DROP INDEX IF EXISTS idx_vs_state;
DROP TABLE IF EXISTS verification_states;
