-- Fixture: the public fingerprint table learning an original's digest. Scoping
-- the index to public derivatives is the whole protection.
CREATE TABLE perceptual_hashes (
	derivative_sha256 TEXT PRIMARY KEY,
	original_sha256 TEXT NOT NULL,
	dhash64 TEXT NOT NULL,
	first_seen_bucket TEXT NOT NULL
);
