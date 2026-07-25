-- Fixture: a column expressing custody nobody can undo. §16 chooses
-- purgeability over deletion-resistance, so no column may say this.
CREATE TABLE archive_items (
	original_sha256 TEXT PRIMARY KEY,
	retain_until TEXT,
	created_bucket TEXT NOT NULL
);
