-- Pre-authored inverse of 0006 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_notice_chain_notice;
DROP TABLE IF EXISTS notice_chain;
DROP INDEX IF EXISTS idx_notices_supersedes;
DROP INDEX IF EXISTS idx_notices_published;
DROP INDEX IF EXISTS idx_notices_epoch;
DROP INDEX IF EXISTS idx_notices_type;
DROP TABLE IF EXISTS notices;
