-- M5: plainclothes identity claims (CLAUDE.md red line 2; ARCHITECTURE §8.2).
--
-- CUSTODY CLASS: SEALED-E2E for the claim body, and NOTHING IS EVER PUBLIC.
--
-- THERE IS NO 'PUBLISHED' VALUE IN THE status CHECK. Not disabled, not
-- flag-gated, not behind a quorum: ABSENT. An UPDATE trying to set one is
-- refused by SQLite, so no code path, no console action, no compelled operator
-- and no later refactor can make this table hold a published claim. The strongest
-- version of a rule is one where the unsafe state has no representation.
--
-- WHY THIS IS THE STRICTER TABLE. Red line 2 is default-DENY because
-- misidentifying a plainclothes officer gets an innocent person hurt — a wrong
-- name here is not a correction later, it is somebody beaten by a crowd. So the
-- claimed identity is NOT STORED PENDING REVIEW at all: this table holds a sealed
-- claim and an evidence hash, and the plaintext identity never lands here.
--
-- THE COLUMN IS sealed_claim, NOT sealed_identity, and that is not cosmetic.
-- gate-naming-gate fails on identity-shaped column names in this table, and the
-- right response to that gate is a better name, not a looser rule. A column
-- called sealed_identity invites a later reader to put an identity in the
-- adjacent plaintext column.
--
-- SEALING REFUSES TODAY. Multi-recipient sealing needs reviewer box keys from
-- reviewer_role_keys (0024), which ships with zero rows, so there is no recipient
-- set and nothing can be sealed. The whole red-line-2 path is structurally dead
-- and stays that way until an offline key ceremony happens.
--
-- ABSENT BY DESIGN: no name, no alias, no handle, no photo, no face, no plate,
-- no phone, no contact, no address, no social account, no badge — not even
-- sealed, because a column that exists is a column somebody fills.
CREATE TABLE plainclothes_claims (
	id TEXT PRIMARY KEY,                       -- opaque ULID
	region_bucket TEXT NOT NULL,
	incident_ref TEXT NOT NULL,                -- opaque ref to the documented event
	-- The claim itself, sealed to the reviewer set client-side. The platform holds
	-- no key and exposes no unwrap endpoint.
	sealed_claim BLOB NOT NULL,
	evidence_sha256 TEXT NOT NULL,             -- hash only; the media stays in the vault
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	-- WITHHELD is the default and the destination. REJECTED and WITHDRAWN are the
	-- only other resting states. There is no fourth direction out of review.
	status TEXT NOT NULL DEFAULT 'WITHHELD'
		CHECK (status IN ('WITHHELD', 'UNDER_REVIEW', 'REJECTED', 'WITHDRAWN')),
	created_bucket TEXT NOT NULL               -- coarse bucket, never a timestamp
);

CREATE INDEX idx_plainclothes_region ON plainclothes_claims (region_bucket);
CREATE INDEX idx_plainclothes_status ON plainclothes_claims (status);
CREATE INDEX idx_plainclothes_incident ON plainclothes_claims (incident_ref);
