-- M3: append-only corrections against an archived item (ARCHITECTURE §16; PRD §4.4).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT. Correction is append-only supersede and
-- never erase: a debunk withdraws LOCAL display of the item and keeps the
-- tamper-evident record that it existed and was retracted. An archive that
-- could quietly unsay something is not an archive, and the whole value of the
-- custody chain is that the sequence of claims is inspectable afterwards.
--
-- THE WITHDRAWAL IS LOCAL, AND THAT IS EXACTLY WHY MIRRORING IS THE LAST
-- HUMAN-GATED STEP. A retraction recorded here does not chase a copy that has
-- already left, which is the honest reason §16 keeps replication and any
-- content-addressed mirror behind a human decision rather than an automatic
-- one. Say that in the product copy rather than implying a retraction reaches
-- everywhere.
--
-- A DISPUTE IS AN INPUT, NEVER AN OUTCOME. Coordinated identical disputes are a
-- coordination signal routed to Disputed plus human review, never automatic
-- suppression: flags that auto-remove are how a resourced adversary buries
-- true reporting, which §15 closes by construction.
--
-- REASON CODES ARE A CLOSED VOCABULARY. Free text beside a public evidence
-- record is how a doxxing payload enters a table nobody screens, so there is no
-- free-text column here at all. The evidence for a dispute is referenced by
-- digest and lives wherever the disputant put it.
-- Every filter column is indexed.
CREATE TABLE archive_disputes (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,     -- append-only order
	original_sha256 TEXT NOT NULL,             -- the item disputed
	reason_code TEXT NOT NULL CHECK (reason_code IN (
		'not_what_it_shows','wrong_place','wrong_date','recycled_media',
		'staged','misattributed','identifies_a_private_person','other_documented')),
	stance TEXT NOT NULL CHECK (stance IN ('dispute','withdraw_dispute','correction')),
	outcome TEXT NOT NULL DEFAULT 'open'
		CHECK (outcome IN ('open','upheld','rejected','superseded')),
	evidence_sha256 TEXT,                      -- digest of supporting material, held elsewhere
	supersedes_seq INTEGER,                    -- the earlier row this one replaces
	raised_bucket TEXT NOT NULL                -- coarse day bucket
	-- ABSENT BY DESIGN: no disputant identity, pseudonym or key, no free text,
	-- no contact of any kind, no precise timestamp, no geo. A row records that a
	-- documented objection exists and what class it is, never who raised it.
);

CREATE INDEX idx_disp_item ON archive_disputes (original_sha256);
CREATE INDEX idx_disp_outcome ON archive_disputes (outcome);
CREATE INDEX idx_disp_stance ON archive_disputes (stance);
CREATE INDEX idx_disp_reason ON archive_disputes (reason_code);
CREATE INDEX idx_disp_supersedes ON archive_disputes (supersedes_seq);
CREATE INDEX idx_disp_raised ON archive_disputes (raised_bucket);
