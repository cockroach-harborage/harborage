CREATE TABLE things (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL
);

CREATE INDEX idx_things_kind ON things (kind);
