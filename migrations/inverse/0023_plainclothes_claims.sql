-- Pre-authored inverse of 0023 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
--
-- This one is SAFE TO APPLY IN A HURRY, and it is the crackdown action for red
-- line 2: dropping the table destroys sealed claims the platform cannot read
-- anyway. Nothing public is lost, because nothing here was ever public.
DROP INDEX IF EXISTS idx_plainclothes_incident;
DROP INDEX IF EXISTS idx_plainclothes_status;
DROP INDEX IF EXISTS idx_plainclothes_region;
DROP TABLE IF EXISTS plainclothes_claims;
