-- PASS fixture. Coarse geo only, and a column named `latency_ms` to prove the
-- column check is ANCHORED rather than substring: a loose /lat/ would fire here
-- and the gate would get weakened by whoever hit it.
CREATE TABLE zone_signals (
	zone_id TEXT PRIMARY KEY,
	coarse_geohash4 TEXT NOT NULL,
	region_bucket TEXT NOT NULL,
	latency_ms INTEGER NOT NULL DEFAULT 0,
	lat REAL,
	lng REAL,
	translation TEXT
);
