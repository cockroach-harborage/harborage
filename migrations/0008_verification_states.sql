-- M2: Verification state projection (PRD §6; ARCHITECTURE §15, §18.3).
-- PUBLIC-PLAINTEXT. The queryable projection of the per-item VerificationState
-- DO, so the console queue and the Cron materializer can read current state
-- without waking one DO per item.
--
-- The DO is the source of truth and serialises concurrent updates; this table
-- follows it. Reach travels as thousandths so it stays an integer on the wire.
--
-- Only Human-Verified and Community-Corroborated are ever admitted to the
-- public index (0005), and neither is reachable autonomously at M2: the first
-- is Layer-B only, the second needs the M3 corroboration machinery which ships
-- off. That is the low autonomous ceiling working as designed, not a gap.
-- Every filter column is indexed.
CREATE TABLE verification_states (
	item_id TEXT PRIMARY KEY,
	item_kind TEXT NOT NULL,                    -- incident | resource_entry
	state TEXT NOT NULL CHECK (state IN (
		'Unverified','AI-Screened','Corroborating','Community-Corroborated',
		'Human-Verified','Disputed','Debunked','Quarantine-Pending'
	)),                                         -- closed taxonomy (§15)
	reach_milli INTEGER NOT NULL DEFAULT 1000, -- 1000 = chronological baseline
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	dispute_count INTEGER NOT NULL DEFAULT 0,
	is_directive INTEGER NOT NULL DEFAULT 0,   -- never amplified above baseline
	first_seen_bucket TEXT NOT NULL,           -- coarse day bucket
	updated_bucket TEXT NOT NULL               -- coarse day bucket
	-- ABSENT BY DESIGN: no author, reporter or corroborator column, no
	-- coordinate column, no per-action instant, no reviewer identity, no vote
	-- rows. Who said what about which item is exactly the edge the invariants
	-- forbid; only counts survive here.
);

CREATE INDEX idx_vs_state ON verification_states (state);
CREATE INDEX idx_vs_kind ON verification_states (item_kind);
CREATE INDEX idx_vs_updated ON verification_states (updated_bucket);
CREATE INDEX idx_vs_directive ON verification_states (is_directive);
