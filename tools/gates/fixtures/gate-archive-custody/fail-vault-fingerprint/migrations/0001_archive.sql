-- Fixture: a fingerprint of a SEALED original in plaintext D1. This is the
-- content-existence oracle §16 removes.
CREATE TABLE archive_items (
	original_sha256 TEXT PRIMARY KEY,
	vault_original_dhash TEXT,
	created_bucket TEXT NOT NULL
);
