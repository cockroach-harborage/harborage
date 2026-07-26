-- Pre-authored inverse of 0025 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
--
-- SAFE TO APPLY IN A HURRY. Every row is {opaque hash, hour, kind}; nothing here
-- identifies a person and nothing here is the system of record. The lawyer's
-- on-device calendar is primary, so dropping this table costs a backup reminder,
-- not a deadline.
DROP INDEX IF EXISTS idx_legal_refs_fired;
DROP INDEX IF EXISTS idx_legal_refs_due;
DROP INDEX IF EXISTS idx_legal_refs_shard;
DROP TABLE IF EXISTS legal_matter_refs;
