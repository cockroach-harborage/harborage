-- M3: evidence-vault content-key rings (ARCHITECTURE §5.4; PRD §4.4).
--
-- CUSTODY CLASS: CLIENT-SIDE E2E. Every row holds ONE opaque blob: a set of
-- content-key copies, each sealed to a DIFFERENT off-platform holder (the
-- reporter's vault key, an off-platform custodian, and for tier B an offshore
-- half that every quorum needs). The platform binds no key that opens any copy
-- and exposes no unwrap endpoint, so "we cannot produce plaintext" is literally
-- true of the evidence original rather than a promise. The consumer WRITES this
-- blob and never attempts to open it -- it cannot.
--
-- Storing the blob here is what makes losing a phone survivable without handing
-- anyone a way in: the copies are useless to us and to a compellable platform,
-- and useful only to the holders named inside them.
--
-- The row is keyed on the pristine original's digest, which is the same anchor
-- the custody chain and the section 63 attestation use, so a keyring can be
-- found for a file without any uploader link existing anywhere.
CREATE TABLE evidence_keyrings (
	original_sha256 TEXT PRIMARY KEY,          -- integrity anchor; the only join key
	tier TEXT NOT NULL CHECK (tier IN ('A','B')),
	keyring BLOB NOT NULL,                     -- opaque; unreadable by this platform
	copy_count INTEGER NOT NULL,
	created_bucket TEXT NOT NULL               -- coarse day bucket, never a precise instant
	-- ABSENT BY DESIGN: no contributor or uploader id, no holder identity, no
	-- holder public key, no incident link, no precise timestamp, no key material
	-- the platform could use. A keyring says only THAT one exists for a digest.
);

CREATE INDEX idx_keyrings_tier ON evidence_keyrings (tier);
CREATE INDEX idx_keyrings_bucket ON evidence_keyrings (created_bucket);
