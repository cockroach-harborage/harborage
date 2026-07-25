-- Pre-authored inverse of 0019 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_skills_created;
DROP INDEX IF EXISTS idx_skills_expires;
DROP INDEX IF EXISTS idx_skills_status;
DROP INDEX IF EXISTS idx_skills_epoch;
DROP INDEX IF EXISTS idx_skills_access;
DROP INDEX IF EXISTS idx_skills_lang;
DROP INDEX IF EXISTS idx_skills_tier;
DROP INDEX IF EXISTS idx_skills_skill;
DROP INDEX IF EXISTS idx_skills_region;
DROP TABLE IF EXISTS skills_registry;
