-- M2: Corroboration dedup (PRD §6; ARCHITECTURE §15).
--
-- One row per (item, corroborator) so the same account cannot corroborate the
-- same item twice. It records that a distinct participant acted, never WHO:
-- there is no key column, no compartment column, and no reverse index.
--
-- THE HONEST LIMIT, written down rather than glossed. `dedup_token` is
-- HMAC(per-item salt, key hash). Anyone holding the salt can TEST a candidate
-- key against it, so this is a membership oracle over the corroborators of one
-- item. It is minimized, not eliminated:
--
--   * the salt is per-item and random, so a token means nothing outside its item
--   * the salt is destroyed when the item's corroboration window closes, after
--     which the tokens are unmatchable even by someone holding everything
--   * rows are swept on the same schedule
--   * there is no index from token back to anything, and this table is never
--     joined to reputation_scalars
--
--   * and the residual: DO point-in-time recovery keeps the salt for ~30 days
--     and cannot be disabled, so destruction is only effective after that
--     window. Only E2E ciphertext, off-platform custody, or memory-only state
--     survive compulsion, and this is none of those.
--
-- The oracle-free construction needs blind tokens / anonymous credentials, which
-- is M3. Until then this table stays inert behind a fail-closed flag.
-- Every filter column is indexed.
CREATE TABLE corroborations (
	entity_id TEXT NOT NULL,                   -- the item corroborated
	dedup_token TEXT NOT NULL,                 -- HMAC(per-item salt, key hash)
	stance TEXT NOT NULL CHECK (stance IN ('corroborate','dispute')),
	at_bucket TEXT NOT NULL,                   -- coarse day bucket
	epoch INTEGER NOT NULL                     -- salt rotation epoch
	-- ABSENT BY DESIGN: no key column, no compartment, no reverse index, no
	-- precise instant, no free text. A flag is an INPUT to the state machine and
	-- never an output to the ranker, and it can never auto-remove anything:
	-- coordinated flagging routes to Disputed plus the human queue.
);

-- Standalone UNIQUE INDEX rather than a table-level UNIQUE: gate-d1-index reads
-- CREATE INDEX statements and does not parse table-level constraints, so an
-- inline UNIQUE would leave the gate believing the column is unindexed.
CREATE UNIQUE INDEX idx_corr_entity_token ON corroborations (entity_id, dedup_token);
CREATE INDEX idx_corr_entity ON corroborations (entity_id);
CREATE INDEX idx_corr_bucket ON corroborations (at_bucket);
CREATE INDEX idx_corr_epoch ON corroborations (epoch);
