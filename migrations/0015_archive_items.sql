-- M3: the permanent public evidence archive (ARCHITECTURE §16; PRD §4.4).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT metadata about media that is either already
-- public or still sealed. It holds no key, no ciphertext and no vault object
-- key, so a compelled dump of this table yields hashes and states rather than
-- content.
--
-- ADMISSION IS FAIL-CLOSED. The default is SEALED_ONLY and every promotion is
-- an explicit conjunction (packages/worker-lib/src/archive/admission.ts): the
-- item must be verified, human-confirmed redacted, screened clean, hold a
-- public derivative, and the archive flag must be on. No partial input reaches
-- ADMITTED. Unverified content is never public and never amplified.
--
-- DURABLE IS NOT PERMANENT. There is deliberately NO column anywhere in this
-- schema that could express custody nobody can undo -- no retention date, no
-- hold marker, no replica pointer. That absence IS the enforcement, and
-- tools/gates/gate-archive-custody.mjs fails the build if one appears. The
-- reason is §16: a multi-party logged purge override has to supersede every
-- durability mechanism for illegal content or a lawful erasure order, and a
-- durability mechanism applied before certainty turns any detection miss into
-- content that can never be removed. Purgeability outranks deletion-resistance,
-- and the two cannot both be absolute.
--
-- WHY original_status IS COPIED RATHER THAN INFERRED. §19 makes it a first-class
-- exported state: a Documented incident is never presented as evidence-backed
-- until the vault actually holds the bytes. The §63 export reads this column and
-- says so, so it has to be recorded here rather than derived from the presence
-- of a row somewhere else.
-- Every filter column is indexed.
CREATE TABLE archive_items (
	original_sha256 TEXT PRIMARY KEY,          -- the sole integrity anchor; kept forever
	citable_id TEXT NOT NULL,                  -- HRB-<base32(sha256(original)[:10])>, derived
	derivative_sha256 TEXT,                    -- the public copy's digest; null while sealed
	public_media_key TEXT,                     -- content-addressed sha256/<hh>/<hash>
	media_kind TEXT NOT NULL CHECK (media_kind IN ('photo','audio','video')),
	admission TEXT NOT NULL DEFAULT 'SEALED_ONLY'
		CHECK (admission IN ('SEALED_ONLY','CANDIDATE','ADMITTED','WITHDRAWN')),
	probation_state TEXT NOT NULL DEFAULT 'OPEN'
		CHECK (probation_state IN ('OPEN','CLEARED','HELD')),
	probation_due_bucket TEXT,                 -- coarse day the window may next be re-scanned
	rescan_count INTEGER NOT NULL DEFAULT 0,
	redaction_confirmed INTEGER NOT NULL DEFAULT 0,  -- human before-and-after confirm
	radioactive_clear INTEGER NOT NULL DEFAULT 0,    -- tier-0 plus known-bad screen passed
	verification_state TEXT NOT NULL DEFAULT 'Unverified',
	original_status TEXT NOT NULL DEFAULT 'on_device_only'
		CHECK (original_status IN ('none','on_device_only','vaulting','vaulted','lost')),
	transform_recipe TEXT,                     -- version-pinned, so rendering is reproducible
	master_state TEXT NOT NULL DEFAULT 'none'
		CHECK (master_state IN ('none','pending','built','skipped_oversize','failed')),
	master_sha256 TEXT,
	source_kind TEXT NOT NULL DEFAULT 'capture'
		CHECK (source_kind IN ('capture','import_reference')),
	canonical_content_id TEXT,                 -- dedup HINT only; never an integrity anchor
	admitted_bucket TEXT,                      -- coarse day bucket
	created_bucket TEXT NOT NULL               -- coarse day bucket
	-- ABSENT BY DESIGN: no contributor or uploader id, no submitter key, no
	-- precise timestamp, no geo, no vault object key, no fingerprint of a sealed
	-- original, and no column of any kind that could record custody nobody can
	-- undo. There is nothing here from which a person could be reached.
);

CREATE UNIQUE INDEX idx_arch_citable ON archive_items (citable_id);
CREATE INDEX idx_arch_derivative ON archive_items (derivative_sha256);
CREATE INDEX idx_arch_admission ON archive_items (admission);
CREATE INDEX idx_arch_probation ON archive_items (probation_state);
CREATE INDEX idx_arch_probation_due ON archive_items (probation_due_bucket);
CREATE INDEX idx_arch_master ON archive_items (master_state);
CREATE INDEX idx_arch_status ON archive_items (original_status);
CREATE INDEX idx_arch_canonical ON archive_items (canonical_content_id);
CREATE INDEX idx_arch_kind ON archive_items (media_kind);
CREATE INDEX idx_arch_source ON archive_items (source_kind);
CREATE INDEX idx_arch_verification ON archive_items (verification_state);
CREATE INDEX idx_arch_created ON archive_items (created_bucket);
