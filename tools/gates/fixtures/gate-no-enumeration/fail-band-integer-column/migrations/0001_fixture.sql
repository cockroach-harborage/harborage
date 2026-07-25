-- PASS fixture. A registry table with a closed skill vocabulary that has no
-- housing-shaped value, and a rollup that can hold a band and nothing numeric.
CREATE TABLE helper_offers (
	id TEXT PRIMARY KEY,
	region_bucket TEXT NOT NULL,
	skill TEXT NOT NULL CHECK (skill IN ('legal_aid','translation','supplies')),
	tier TEXT NOT NULL DEFAULT 'BASIC',
	dedup_token TEXT NOT NULL,
	UNIQUE (region_bucket, skill, dedup_token)
);

CREATE TABLE help_bands (
	region_bucket TEXT NOT NULL,
	skill TEXT NOT NULL,
	tier TEXT NOT NULL,
	band TEXT NOT NULL CHECK (band IN ('NONE','SOME','MANY')),
	built_bucket TEXT NOT NULL,
	pack_epoch INTEGER NOT NULL DEFAULT 0,
	-- An integer column that is NOT named like a count, so only the declared-type
	-- rule can catch it. fail-band-has-a-count trips the type rule AND the naming
	-- rule at once, which would let either be deleted with that fixture still red.
	pack_size INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (region_bucket, skill, tier)
);

CREATE TABLE resource_entries (
	id TEXT PRIMARY KEY,
	entity_type TEXT NOT NULL,
	subcategory TEXT NOT NULL
);
