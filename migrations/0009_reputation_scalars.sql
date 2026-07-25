-- M2: Per-compartment reputation scalars (PRD §4.3; ARCHITECTURE §15, §4.2).
-- ENCRYPTED-AT-REST, which §4.1 rates "No — treat as compellable". Nothing here
-- is ephemeral: D1 Time Travel is ~30 days and cannot be disabled.
--
-- MILESTONE NOTE. §4.2 previously put this table at M3, on the reasoning that
-- creating it early accumulates a compellable per-compartment roster over the
-- Time-Travel window while gating nothing. That objection is about ROWS, not
-- about tables. The table and its code land here with every write behind a
-- fail-closed flag, so zero rows exist until switch-on — which is exactly what
-- §18.2 prescribes: build now, flip later. §4.2 is updated to match.
--
-- Reputation is a derived SCALAR and never a graph. There is no voucher column,
-- no who-trusted-whom edge, and no way to list members: the invariant is "no
-- identity-bearing directory", and reads are always by a known key hash, never
-- by enumeration. Switch-on is additionally gated on blind-token-carried
-- reputation so the server holds no list at all.
--
-- Reputation is OUTCOME-SETTLED, not earned by receiving votes: a mob can
-- generate unlimited votes but cannot cheaply generate settled outcomes.
-- Every filter column is indexed.
CREATE TABLE reputation_scalars (
	key_hash TEXT NOT NULL,                    -- opaque hash of the compartment key
	compartment TEXT NOT NULL,                 -- reputation is per-compartment; feed rep grants zero power in accountability
	scalar_milli INTEGER NOT NULL DEFAULT 50, -- r in thousandths; new accounts start near-powerless
	settled_count INTEGER NOT NULL DEFAULT 0, -- coarse counter, never a list of what
	epoch INTEGER NOT NULL,                    -- rotation epoch
	updated_bucket TEXT NOT NULL,              -- coarse day bucket
	PRIMARY KEY (key_hash, compartment)
	-- ABSENT BY DESIGN: no display name, no contact, no vouching edge, no item
	-- references, no per-action instant. Only a scalar and coarse counters.
);

CREATE INDEX idx_rep_compartment ON reputation_scalars (compartment);
CREATE INDEX idx_rep_epoch ON reputation_scalars (epoch);
CREATE INDEX idx_rep_updated ON reputation_scalars (updated_bucket);
