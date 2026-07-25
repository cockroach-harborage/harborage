-- M3: what is known about where an archived item came from (ARCHITECTURE §16,
-- §7.4; PRD §4.4).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT, and deliberately thin. Provenance is the
-- part of an evidence archive most likely to grow into a contributor dossier,
-- so what is NOT here matters more than what is: no key material, no raw sensor
-- bundle, no coordinates, no handset string, no per-item precise timestamp. §16
-- requires that anything leaving Cloudflare carries none of those, and the
-- cheapest way to guarantee it is never to record them.
--
-- ABSENCE OF A CAPTURE ASSERTION IS SHOWN NEUTRAL, NEVER AS DOUBT. Most real
-- footage from a cheap phone carries no signed capture assertion at all,
-- because the feature ships on expensive handsets first. Treating `absent` as
-- suspicious would quietly rank the poorest reporters last and would tell an
-- adversary which contributors can afford a recent phone. `capture_assertion`
-- has three values and only `invalid` is a negative signal.
--
-- `contributor_band` IS A BAND, NOT A CONTRIBUTOR. It records that an item came
-- from a rough experience tier so that recycled-media and coordination signals
-- have something to weigh. It is not a pseudonym, it is not stable across
-- items, and there is no column here that links two items to one person: §16's
-- structural rule is that no contributor-to-item edge exists anywhere.
-- Every filter column is indexed.
CREATE TABLE archive_provenance (
	original_sha256 TEXT PRIMARY KEY,          -- same anchor as archive_items
	capture_assertion TEXT NOT NULL DEFAULT 'absent'
		CHECK (capture_assertion IN ('valid','invalid','absent')),
	capture_day_bucket TEXT,                   -- coarse day, never a precise instant
	capture_confidence_milli INTEGER NOT NULL DEFAULT 0,
	independent_source_count INTEGER NOT NULL DEFAULT 0,
	contributor_band TEXT NOT NULL DEFAULT 'unbanded'
		CHECK (contributor_band IN ('unbanded','new','established','trusted')),
	checkpoint_root TEXT,                      -- Merkle root this item was folded into
	checkpoint_seq INTEGER,                    -- position within that checkpoint
	poster_state TEXT NOT NULL DEFAULT 'not_applicable'
		CHECK (poster_state IN ('not_applicable','built','decode_failed')),
	poster_codec TEXT,                         -- a codec name, never a handset
	recorded_bucket TEXT NOT NULL              -- coarse day bucket
	-- ABSENT BY DESIGN: no contributor public key, no per-capture signing
	-- material, no raw sensor bundle, no coordinates, no precise instant, no
	-- handset or model string, no network operator, no free text, and no column
	-- that would link two items to one contributor.
);

CREATE INDEX idx_prov_assertion ON archive_provenance (capture_assertion);
CREATE INDEX idx_prov_band ON archive_provenance (contributor_band);
CREATE INDEX idx_prov_root ON archive_provenance (checkpoint_root);
CREATE INDEX idx_prov_poster ON archive_provenance (poster_state);
CREATE INDEX idx_prov_recorded ON archive_provenance (recorded_bucket);
