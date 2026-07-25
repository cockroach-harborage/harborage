-- M5: institutional accountability records (PRD §4.10; ARCHITECTURE §8.2).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT once published, and NOTHING BEFORE THAT.
--
-- THIS TABLE IS WHERE RED LINE 1 STOPS BEING A POLICY AND BECOMES A CONSTRAINT.
-- The charter says accountability may name official-capacity misconduct only,
-- tied to a specific documented incident, and only after a multi-person Review
-- gate. Policy alone is not enough: policy is an `if` in a Worker, and a Worker
-- can be compelled to skip an `if`. So the two properties that matter are CHECK
-- constraints, and SQLite refuses the write even if every line of application
-- code is replaced.
--
-- CONSTRAINT 1 — AN UNPUBLISHED ROW CANNOT HOLD AN INDIVIDUAL IDENTIFIER.
-- This is the one that matters most and it is not obvious. Without it, a table of
-- rows in UNDER_REVIEW would be a list of officials under investigation: exactly
-- the target list the charter forbids, sitting in a compellable database,
-- assembled by us. With it, naming-pending-review is stored NOWHERE, so a
-- compelled dump of this table yields only what is already public.
--
-- It also means the Review gate cannot be "worked around" by writing the name
-- early and flipping status later: the name has nowhere to wait.
--
-- CONSTRAINT 2 — PUBLICATION REQUIRES EVERY §8.2 CONDITION, in one expression,
-- so removing a condition is a visible deletion from this file rather than a
-- quietly loosened branch in a Worker.
--
-- quorum_bundle, record_hash and directory_epoch ARE PUBLIC COLUMNS ON PURPOSE.
-- They are what lets a reader re-verify the quorum on their own device without
-- trusting us. The platform holds no signing key for any of them: no Ed25519
-- signing function exists anywhere in packages/crypto, only verification.
--
-- ABSENT BY DESIGN: no home address, no family, no private contact, no private
-- social account, no personal-life field, no photo, no plate, no "wanted"
-- status, no bounty, no call to action, no complainant identity, no detainee
-- identity. Most-identifying dossiers stay off-platform on the lawyer side; this
-- table holds opaque refs and hashes.
--
-- ZERO ROWS AT REST, and the flag governing publication is FLIPPABLE only in
-- flag-policy.ts while `accountability_naming` is LOCKED with no FLAG_NAMES
-- entry at all — so no runtime read path for it typechecks.
CREATE TABLE accountability_records (
	id TEXT PRIMARY KEY,                       -- opaque ULID
	-- The institution. This is the PRIMARY surface (§4.10): patterns by station,
	-- unit, rank band and shift, which never resolve to one person.
	station_code TEXT NOT NULL,                -- official station/post identifier
	unit_code TEXT,                            -- official unit, where established
	rank_band TEXT,                            -- coarse band, never a badge number
	shift_bucket TEXT,                         -- coarse window, never a timestamp
	region_bucket TEXT NOT NULL,
	-- The documented incident this record is tied to. A record with no anchor is
	-- an allegation about a person floating free of any event.
	incident_ref TEXT NOT NULL,                -- opaque ref, never a URL
	documentary_anchor_sha256 TEXT,            -- hash of the anchoring document
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	-- The individual identifier. NULL unless PUBLISHED, enforced below.
	official_name TEXT,                        -- official capacity only
	official_badge TEXT,                       -- badge/rank/unit/station only
	-- The gate's own output, all publicly checkable.
	verification_state TEXT NOT NULL DEFAULT 'Unverified',
	cta_classifier_pass INTEGER NOT NULL DEFAULT 0 CHECK (cta_classifier_pass IN (0, 1)),
	right_of_reply_ref TEXT,                   -- opaque ref to the offer + response
	quorum_bundle TEXT,                        -- m-of-n reviewer signatures, public
	record_hash TEXT,                          -- canonical hash the signatures cover
	directory_epoch INTEGER,                   -- key_directory epoch to verify against
	status TEXT NOT NULL DEFAULT 'DRAFT'
		CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'WITHHELD', 'PUBLISHED', 'SUPERSEDED', 'REMOVED')),
	created_bucket TEXT NOT NULL,              -- coarse bucket, never a timestamp

	-- CONSTRAINT 1. An individual identifier may exist only in a PUBLISHED row.
	-- So there is no store of names awaiting review, anywhere, ever.
	CHECK (status = 'PUBLISHED' OR (official_name IS NULL AND official_badge IS NULL)),

	-- CONSTRAINT 2. Every §8.2 condition, or the row cannot be PUBLISHED.
	-- Human-Verified is Layer-B only: the autonomous ceiling is
	-- Community-Corroborated, and there is no code path from it to this value.
	CHECK (
		status <> 'PUBLISHED'
		OR (
			verification_state = 'Human-Verified'
			AND cta_classifier_pass = 1
			AND documentary_anchor_sha256 IS NOT NULL
			AND right_of_reply_ref IS NOT NULL
			AND quorum_bundle IS NOT NULL
			AND record_hash IS NOT NULL
			AND directory_epoch IS NOT NULL
			AND corroboration_count >= 3
		)
	)
);

CREATE INDEX idx_acct_station ON accountability_records (station_code);
CREATE INDEX idx_acct_region ON accountability_records (region_bucket);
CREATE INDEX idx_acct_status ON accountability_records (status);
CREATE INDEX idx_acct_incident ON accountability_records (incident_ref);
