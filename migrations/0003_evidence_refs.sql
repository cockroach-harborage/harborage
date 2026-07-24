-- M1: evidence reference rows (ARCHITECTURE §7.6, §16). Content-addressed
-- pointers into R2 — the platform stores hashes, opaque keys, and a version-pinned
-- transform recipe, never plaintext media on the hot path. Structural invariants:
-- NO contributor->item edge (contributor pseudonymity is structural, §16); the
-- incident_id link is content-to-content only. original_sha256 is the sole
-- integrity anchor and is kept forever, even for a later-purged item (audit row).
CREATE TABLE evidence_refs (
	id TEXT PRIMARY KEY,                       -- opaque ULID
	incident_id TEXT,                          -- content link to incidents.id (nullable; NOT an uploader edge)
	media_kind TEXT NOT NULL,                  -- photo / audio / video / text
	original_sha256 TEXT NOT NULL,             -- integrity anchor (§63 BSA); always kept
	derivative_sha256 TEXT,                    -- public redacted derivative hash (null until redacted)
	vault_key TEXT,                            -- opaque ULID object key in evidence-vault R2 (sealed original)
	public_media_key TEXT,                     -- content-addressed public-media R2 key (redacted derivative)
	transform_recipe TEXT,                     -- version-pinned redaction/transcode recipe id
	canonical_content_id TEXT,                 -- source-import dedup HINT (reel/video/post id); never an anchor
	redaction_state TEXT NOT NULL DEFAULT 'SEALED_ONLY',  -- SEALED_ONLY until human before/after confirm
	created_bucket TEXT NOT NULL               -- coarse ingest day bucket (no precise timestamp)
	-- ABSENT BY DESIGN: no contributor/uploader id, no per-item precise timestamp,
	-- no raw sensor bundle, no key material.
);

CREATE INDEX idx_evidence_incident ON evidence_refs (incident_id);
CREATE INDEX idx_evidence_original ON evidence_refs (original_sha256);
CREATE INDEX idx_evidence_canonical ON evidence_refs (canonical_content_id);
CREATE INDEX idx_evidence_redaction ON evidence_refs (redaction_state);
