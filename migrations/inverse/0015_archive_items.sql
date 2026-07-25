-- Pre-authored inverse of 0015 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_arch_created;
DROP INDEX IF EXISTS idx_arch_verification;
DROP INDEX IF EXISTS idx_arch_source;
DROP INDEX IF EXISTS idx_arch_kind;
DROP INDEX IF EXISTS idx_arch_canonical;
DROP INDEX IF EXISTS idx_arch_status;
DROP INDEX IF EXISTS idx_arch_master;
DROP INDEX IF EXISTS idx_arch_probation_due;
DROP INDEX IF EXISTS idx_arch_probation;
DROP INDEX IF EXISTS idx_arch_admission;
DROP INDEX IF EXISTS idx_arch_derivative;
DROP INDEX IF EXISTS idx_arch_citable;
DROP TABLE IF EXISTS archive_items;
