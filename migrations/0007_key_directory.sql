-- M1: Signed Key Directory + Revocation List (PRD §4.2; ARCHITECTURE §5.5).
-- PUBLIC-PLAINTEXT. Role-bound Ed25519 public keys for official notices,
-- versioned and epoch-stamped and signed as a unit. Also shipped INSIDE the
-- signed offline pack so a revocation reaches a long-offline client out of band
-- (peer QR/file), not only over the network.
--
-- The client verifies a notice by checking, for each signer: signer in
-- directory, signer NOT in revocation, notice epoch >= key validity, and the
-- revocation list's epoch >= min_revocation_epoch (a freshness floor that
-- detects a rolled-back stale list). Every filter column is indexed.
CREATE TABLE key_directory (
	key_id TEXT PRIMARY KEY,                    -- 8-byte minisign/Ed key id (hex)
	public_key TEXT NOT NULL,                  -- base64 Ed25519 public key
	role TEXT NOT NULL,                        -- role binding: official_notice | marshal | canary | pack
	valid_from_epoch INTEGER NOT NULL,
	valid_to_epoch INTEGER,                     -- NULL = open-ended
	directory_epoch INTEGER NOT NULL,          -- version of the directory this row belongs to
	directory_signature TEXT NOT NULL          -- signature over the canonical directory at that epoch
	-- ABSENT BY DESIGN: no natural-person identity behind a role key; keys are
	-- roles. The identity->pseudonym map does not exist anywhere.
);

CREATE INDEX idx_key_directory_role ON key_directory (role);
CREATE INDEX idx_key_directory_dir_epoch ON key_directory (directory_epoch);

CREATE TABLE revocation_list (
	key_id TEXT PRIMARY KEY,                    -- revoked key id (hex)
	revoked_at_epoch INTEGER NOT NULL,
	list_epoch INTEGER NOT NULL,               -- version of the revocation list
	min_revocation_epoch INTEGER NOT NULL,     -- freshness floor: reject a list older than this
	list_signature TEXT NOT NULL               -- signature over the canonical revocation list
);

CREATE INDEX idx_revocation_list_epoch ON revocation_list (list_epoch);
