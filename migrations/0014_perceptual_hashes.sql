-- M3: perceptual fingerprints of PUBLIC derivatives only (ARCHITECTURE §16
-- Lever 1, §7.3; PRD §4.4).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT, scoped hard. Every row fingerprints a
-- derivative the platform already holds in the clear and already publishes. A
-- fingerprint of a SEALED vault original is NEVER written here. That is not
-- taste: a plaintext fingerprint of unreadable content is a content-existence
-- oracle -- anyone holding a copy of an original could test whether we hold it
-- -- which is also why vault objects use opaque keys and never content-derived
-- ones. tools/gates/gate-archive-custody.mjs fails the build on any column that
-- would carry one.
--
-- THE HONEST LIMIT. `dhash64` is computed ON THE CLIENT, because a Worker
-- cannot decode pixels and the Images binding reports dimensions rather than
-- pixels. So this value is ATTACKER-CONTROLLED. It is advisory and
-- presentation-only: it groups reposts of one clip under one incident and feeds
-- the recycled-media signal. It never decides keep-or-discard, and it is
-- recomputable server-side later from bytes we already hold, at which point a
-- lying client is simply corrected.
--
-- WHY BANDS AND NOT A VECTOR INDEX. Near-duplicate lookup here is Hamming
-- distance over 64 bits. Vectorize offers cosine, euclidean and dot product
-- only, so it is the wrong tool and is not used anywhere in this repository.
-- The four 16-bit band columns are a banded LSH: two derivatives within a small
-- radius agree on at least one band with high probability, so the Worker seeks
-- candidates by an indexed equality on one band and computes exact Hamming in
-- memory over a handful of rows. Rows-read stays rows-scanned.
--
-- PERCEPTUAL MATCHING NEVER REMOVES AN OBJECT. Exact-byte dedup collapses
-- storage; perceptual dedup collapses PRESENTATION. Two witnesses filming one
-- event from different angles are distinct evidence, and keying keep-or-discard
-- on a perceptual cluster would destroy the second angle.
-- Every filter column is indexed.
CREATE TABLE perceptual_hashes (
	derivative_sha256 TEXT PRIMARY KEY,        -- the PUBLIC copy's own digest
	dhash64 TEXT NOT NULL,                     -- 16 lowercase hex chars, advisory
	band0 TEXT NOT NULL,                       -- bits 0..15, LSH candidate bucket
	band1 TEXT NOT NULL,                       -- bits 16..31
	band2 TEXT NOT NULL,                       -- bits 32..47
	band3 TEXT NOT NULL,                       -- bits 48..63
	hash_source TEXT NOT NULL CHECK (hash_source IN ('client','server')),
	algo_version TEXT NOT NULL,                -- pinned tool version; a hint, never an anchor
	first_seen_bucket TEXT NOT NULL            -- coarse day bucket, never a precise instant
	-- ABSENT BY DESIGN: no fingerprint of a sealed original, no original digest,
	-- no vault object key, no contributor or uploader link, no incident link, no
	-- precise timestamp, no geo, no free text. A row says only THAT a published
	-- derivative looks like this.
);

CREATE INDEX idx_phash_band0 ON perceptual_hashes (band0);
CREATE INDEX idx_phash_band1 ON perceptual_hashes (band1);
CREATE INDEX idx_phash_band2 ON perceptual_hashes (band2);
CREATE INDEX idx_phash_band3 ON perceptual_hashes (band3);
CREATE INDEX idx_phash_seen ON perceptual_hashes (first_seen_bucket);
