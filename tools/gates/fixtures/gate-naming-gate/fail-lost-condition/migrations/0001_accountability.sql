-- Minimal accountability schema carrying both load-bearing CHECKs.
CREATE TABLE accountability_records (
	id TEXT PRIMARY KEY,
	station_code TEXT NOT NULL,
	region_bucket TEXT NOT NULL,
	incident_ref TEXT NOT NULL,
	documentary_anchor_sha256 TEXT,
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	official_name TEXT,
	official_badge TEXT,
	verification_state TEXT NOT NULL DEFAULT 'Unverified',
	cta_classifier_pass INTEGER NOT NULL DEFAULT 0 CHECK (cta_classifier_pass IN (0, 1)),
	right_of_reply_ref TEXT,
	quorum_bundle TEXT,
	record_hash TEXT,
	directory_epoch INTEGER,
	status TEXT NOT NULL DEFAULT 'DRAFT'
		CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'WITHHELD', 'PUBLISHED', 'SUPERSEDED', 'REMOVED')),
	created_bucket TEXT NOT NULL,
	CHECK (status = 'PUBLISHED' OR (official_name IS NULL AND official_badge IS NULL)),
	CHECK (
		status <> 'PUBLISHED'
		OR (
			verification_state = 'Human-Verified'
			AND cta_classifier_pass = 1
			AND documentary_anchor_sha256 IS NOT NULL
			AND quorum_bundle IS NOT NULL
			AND record_hash IS NOT NULL
			AND directory_epoch IS NOT NULL
			AND corroboration_count >= 3
		)
	)
);

CREATE TABLE plainclothes_claims (
	id TEXT PRIMARY KEY,
	region_bucket TEXT NOT NULL,
	incident_ref TEXT NOT NULL,
	sealed_claim BLOB NOT NULL,
	evidence_sha256 TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'WITHHELD'
		CHECK (status IN ('WITHHELD', 'UNDER_REVIEW', 'REJECTED', 'WITHDRAWN')),
	created_bucket TEXT NOT NULL
);

CREATE TABLE reviewer_role_keys (
	key_id TEXT PRIMARY KEY,
	public_box_key TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('naming_reviewer', 'plainclothes_reviewer')),
	valid_from_epoch INTEGER NOT NULL,
	revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);
