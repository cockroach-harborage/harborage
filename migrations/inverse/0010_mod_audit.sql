-- Pre-authored inverse of 0010 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_mod_audit_bucket;
DROP INDEX IF EXISTS idx_mod_audit_actor;
DROP INDEX IF EXISTS idx_mod_audit_action;
DROP INDEX IF EXISTS idx_mod_audit_item;
DROP TABLE IF EXISTS mod_audit;
