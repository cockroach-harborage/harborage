-- Pre-authored inverse of 0001 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_feature_flag_audit_name;
DROP INDEX IF EXISTS idx_feature_flag_audit_at;
DROP TABLE IF EXISTS feature_flag_audit;
