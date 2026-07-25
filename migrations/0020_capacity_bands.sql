-- M4: the ONLY public read of helper capacity (PRD §4.9).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT, materialized by Cron from skills_registry.
--
-- A BAND, NEVER A COUNT. "Two lawyers in this district" is a number small enough
-- to act on: it tells an adversary how thin the support is and how many people
-- to remove to make it zero. There is deliberately no integer column here that
-- could hold one, and no code path that could produce one. NONE covers a floor
-- rather than exactly zero, so one lawyer and no lawyers read the same.
--
-- THE GRID IS FIXED. Every (region, skill, tier) cell is written every cycle,
-- including empty ones, because the PRESENCE of a row would itself be a signal:
-- a table containing only the cells that have helpers is a map of where helpers
-- are. Only the band value moves.
--
-- WHY A SEPARATE MIGRATION FROM 0019. The inverse of this one must be applicable
-- ALONE. "Stop publishing capacity" is something you do during a crackdown
-- without destroying the registry, and "drop the registry" is something you do
-- without breaking the read model's shape. One file makes both all-or-nothing.
--
-- Every filter column is indexed (ARCHITECTURE §4.2).
CREATE TABLE capacity_bands (
	region_bucket TEXT NOT NULL,
	skill TEXT NOT NULL,
	tier TEXT NOT NULL,
	band TEXT NOT NULL CHECK (band IN ('NONE','SOME','MANY')),
	built_bucket TEXT NOT NULL,                -- coarse day bucket
	pack_epoch INTEGER NOT NULL DEFAULT 0,     -- signed rollup epoch, not a time
	PRIMARY KEY (region_bucket, skill, tier)
	-- ABSENT BY DESIGN: no count of any kind, no id, no token, no timestamp finer
	-- than a day bucket, no geography finer than the district code, no link back
	-- to any offer row, and nothing that could be joined to one.
);

CREATE INDEX idx_bands_region ON capacity_bands (region_bucket);
CREATE INDEX idx_bands_skill ON capacity_bands (skill);
CREATE INDEX idx_bands_tier ON capacity_bands (tier);
CREATE INDEX idx_bands_band ON capacity_bands (band);
CREATE INDEX idx_bands_built ON capacity_bands (built_bucket);
