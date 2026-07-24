-- Pre-authored inverse of 0004 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_resource_status;
DROP INDEX IF EXISTS idx_resource_core;
DROP INDEX IF EXISTS idx_resource_trust;
DROP INDEX IF EXISTS idx_resource_state;
DROP INDEX IF EXISTS idx_resource_visibility;
DROP INDEX IF EXISTS idx_resource_accessibility;
DROP INDEX IF EXISTS idx_resource_languages;
DROP INDEX IF EXISTS idx_resource_geo6;
DROP INDEX IF EXISTS idx_resource_geo;
DROP INDEX IF EXISTS idx_resource_region;
DROP INDEX IF EXISTS idx_resource_subcategory;
DROP INDEX IF EXISTS idx_resource_category;
DROP INDEX IF EXISTS idx_resource_entity;
DROP TABLE IF EXISTS resource_entries;
