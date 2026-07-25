-- Fixture: both tables individually clean, so only the QUERY below is wrong.
CREATE TABLE perceptual_hashes (
	derivative_sha256 TEXT PRIMARY KEY,
	dhash64 TEXT NOT NULL,
	first_seen_bucket TEXT NOT NULL
);
