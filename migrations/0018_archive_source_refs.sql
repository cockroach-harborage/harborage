-- M3: fingerprint-and-reference for off-platform media (ARCHITECTURE §16, §7.3).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT, and deliberately almost empty. An imported
-- reference is NOT an archived item: we hold no bytes, so there is nothing to
-- anchor and nothing to preserve. It records only that a clip identified by a
-- publisher's own content id was pointed at, and what it looked like to the
-- client that pointed.
--
-- WHY A SEPARATE TABLE. archive_items is keyed on original_sha256, which is the
-- integrity anchor the custody chain and the section 63 attestation both read.
-- An import has no bytes and therefore no digest, so giving it a synthetic one
-- would put a lie in the one column that must never lie. A second table is the
-- cheaper honesty.
--
-- THERE IS NO FETCH. Not a disabled fetch, not a fetch behind a flag: no code
-- path in this repository retrieves an imported URL. Re-hosting someone else's
-- media is the counsel-gated source-terms question, and the off-platform egress
-- that would make it safe to attempt does not exist. No URL is stored either --
-- a URL plus a submission time is a soft link between a submitter and a target.
-- Every filter column is indexed.
CREATE TABLE archive_source_refs (
	canonical_content_id TEXT PRIMARY KEY,     -- the publisher's own id, as supplied
	dhash64 TEXT NOT NULL,                     -- client-computed, advisory, attacker-controlled
	band0 TEXT NOT NULL,
	band1 TEXT NOT NULL,
	band2 TEXT NOT NULL,
	band3 TEXT NOT NULL,
	reference_state TEXT NOT NULL DEFAULT 'REFERENCED'
		CHECK (reference_state IN ('REFERENCED','WITHDRAWN')),
	first_seen_bucket TEXT NOT NULL            -- coarse day bucket
	-- ABSENT BY DESIGN: no URL, no fetched bytes, no digest of anything we hold,
	-- no submitter, no pseudonym, no link to archive_items or to any incident,
	-- no precise timestamp. A row says only that a public clip was pointed at.
);

CREATE INDEX idx_srcref_band0 ON archive_source_refs (band0);
CREATE INDEX idx_srcref_band1 ON archive_source_refs (band1);
CREATE INDEX idx_srcref_band2 ON archive_source_refs (band2);
CREATE INDEX idx_srcref_band3 ON archive_source_refs (band3);
CREATE INDEX idx_srcref_state ON archive_source_refs (reference_state);
CREATE INDEX idx_srcref_seen ON archive_source_refs (first_seen_bucket);
