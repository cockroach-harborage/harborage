-- Pre-authored inverse of 0007 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_revocation_list_epoch;
DROP TABLE IF EXISTS revocation_list;
DROP INDEX IF EXISTS idx_key_directory_dir_epoch;
DROP INDEX IF EXISTS idx_key_directory_role;
DROP TABLE IF EXISTS key_directory;
