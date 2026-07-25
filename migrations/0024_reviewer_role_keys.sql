-- M5: reviewer sealing keys for the Naming Review gate (ARCHITECTURE §8.2).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT. These are PUBLIC X25519 box keys. No private
-- key material exists here, in CI, or anywhere on Cloudflare.
--
-- A SEPARATE TABLE, NEVER AN ALTER ON key_directory, and the reason is a specific
-- footgun. key_directory holds Ed25519 SIGNING keys. Deriving an X25519 sealing
-- key from an Ed25519 signing key through the birational map between the curves is
-- a well-known mistake: it reuses one keypair across two protocols with different
-- security assumptions, and a signing oracle plus a decryption oracle over the
-- same secret is a combination neither scheme was analysed under. Two tables means
-- the two key types cannot be confused by a JOIN, and cannot be conflated by
-- someone adding a column to the wrong one.
--
-- SEALING IS MULTI-RECIPIENT, reusing the existing ALG_VAULT_KEYRING shape: one
-- random content key, one sealTo() per reviewer box key. No org-wrapped copy, no
-- platform recipient, no escrow entry. M4 and M5 together add ZERO platform
-- unseal keys, which gate-sealed-body already enforces.
--
-- ZERO ROWS AT REST, AND THAT IS THE SWITCH-OFF. With no rows there is no
-- recipient set, so sealing a plainclothes claim is impossible and the whole
-- red-line-2 path is structurally dead. Populating this table is an offline
-- m-of-n hardware-token ceremony recorded in RUNBOOK — not a migration, not a
-- console action, and gate-naming-gate fails the build on any migration that
-- INSERTs here.
--
-- REMOVAL IS SINGLE-REVIEWER BY DESIGN. Revoking a reviewer key shrinks the
-- quorum and can only make publication HARDER. An infiltrated reviewer's maximum
-- unilateral harm is therefore suppression, which is the accepted fail-safe
-- direction (CLAUDE.md §5).
CREATE TABLE reviewer_role_keys (
	key_id TEXT PRIMARY KEY,                   -- opaque; issued in the ceremony
	-- PUBLIC X25519 key, base64. Never a private key, never a share of one.
	public_box_key TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('naming_reviewer', 'plainclothes_reviewer')),
	valid_from_epoch INTEGER NOT NULL,
	valid_to_epoch INTEGER,                    -- NULL = current
	revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
	-- ABSENT BY DESIGN: no reviewer name, no contact, no device id, no IP, no
	-- last-seen, no session. A row identifies a KEY, never a person. There is no
	-- reviewer directory, because a list of the people who can name officials is
	-- itself a target list.
);

CREATE INDEX idx_reviewer_keys_role ON reviewer_role_keys (role);
CREATE INDEX idx_reviewer_keys_revoked ON reviewer_role_keys (revoked);
