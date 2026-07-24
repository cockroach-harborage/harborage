-- M1: Official Notices (PRD §4.2; ARCHITECTURE §2 row 2, §4.2). PUBLIC-PLAINTEXT.
-- A cryptographically-signed one-to-many broadcast channel, visibly distinct
-- from user posts. The signature set + role-key refs + payload hash TRAVEL with
-- each notice, so a hijacked account or a compelled CDN cannot mint a valid
-- directive: trust is the signature, not who served it.
--
-- Location is area/landmark-level TEXT only. There is deliberately NO coordinate
-- column here (red line 3: no live individual location). Corrections are
-- append-only supersede rows, never edits (history cannot be silently rewritten).
-- Every filter column is indexed.
CREATE TABLE notices (
	id TEXT PRIMARY KEY,                        -- opaque notice id (ULID)
	epoch INTEGER NOT NULL,                     -- notice epoch; client checks >= signer-key validity
	notice_type TEXT NOT NULL CHECK (notice_type IN (
		'safety_directive','logistics','legal_status','correction','detention_alert','transparency'
	)),                                         -- closed taxonomy (PRD §4.2)
	title_i18n TEXT NOT NULL,                   -- JSON {en, hi, ...}
	body_i18n TEXT NOT NULL,                    -- JSON {en, hi, ...}
	area TEXT,                                  -- area/landmark-level TEXT only (no coordinate column exists)
	payload_hash TEXT NOT NULL,                -- hex SHA-256 of the canonical notice payload
	signature_set TEXT NOT NULL,               -- JSON [{key_id, sig}] — independent m-of-n
	signer_key_ids TEXT NOT NULL,              -- JSON [key_id] (denormalized for display)
	published_at TEXT NOT NULL,                -- ISO date the console appended it
	supersedes TEXT,                           -- id of a notice this corrects (append-only supersede)
	superseded_by TEXT                         -- set when a later notice supersedes this one
	-- ABSENT BY DESIGN: no author identity, no recipient/roster, no coordinate,
	-- no reader/query log. Signers are ROLES (key ids), never doxxed people.
);

CREATE INDEX idx_notices_type ON notices (notice_type);
CREATE INDEX idx_notices_epoch ON notices (epoch);
CREATE INDEX idx_notices_published ON notices (published_at);
CREATE INDEX idx_notices_supersedes ON notices (supersedes);

-- Append-only hash chain over notices, in insertion order:
--   H_0 = 32 zero bytes; H_i = SHA-256( H_{i-1} || payload_hash_i )
-- A break in the chain makes silent insertion/removal/reordering detectable,
-- even against us. Periodic signed Merkle checkpoints are computed by the
-- NoticeLog DO (public by design).
CREATE TABLE notice_chain (
	seq INTEGER PRIMARY KEY,                    -- 0-based position in the chain
	notice_id TEXT NOT NULL UNIQUE,
	prev_hash TEXT NOT NULL,                    -- hex H_{i-1}
	entry_hash TEXT NOT NULL                    -- hex H_i
);

CREATE INDEX idx_notice_chain_notice ON notice_chain (notice_id);
