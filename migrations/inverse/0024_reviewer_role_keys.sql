-- Pre-authored inverse of 0024 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
--
-- Dropping this table makes the recipient set empty, so sealing refuses and the
-- naming path goes structurally dead. That is the fail-safe direction, so this
-- inverse is applicable on its own without touching 0022 or 0023. The keys are
-- public and are re-derivable from the ceremony record; no secret is lost.
DROP INDEX IF EXISTS idx_reviewer_keys_revoked;
DROP INDEX IF EXISTS idx_reviewer_keys_role;
DROP TABLE IF EXISTS reviewer_role_keys;
