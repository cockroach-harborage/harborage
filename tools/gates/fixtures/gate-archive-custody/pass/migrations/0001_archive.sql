-- Fixture: the shape the gate is meant to ALLOW. Exercises every check rather
-- than merely avoiding it: a real perceptual_hashes table, a real archive table
-- with no permanent-custody column, and a real query below.
CREATE TABLE perceptual_hashes (
	derivative_sha256 TEXT PRIMARY KEY,
	dhash64 TEXT NOT NULL,
	band0 TEXT NOT NULL,
	first_seen_bucket TEXT NOT NULL
);
CREATE INDEX idx_phash_band0 ON perceptual_hashes (band0);

CREATE TABLE archive_items (
	original_sha256 TEXT PRIMARY KEY,
	admission TEXT NOT NULL DEFAULT 'SEALED_ONLY',
	probation_state TEXT NOT NULL DEFAULT 'OPEN',
	created_bucket TEXT NOT NULL
);
CREATE INDEX idx_arch_admission ON archive_items (admission);
