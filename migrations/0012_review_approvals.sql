-- M2: Two-person approval intents for the console (ARCHITECTURE §15 Layer B).
--
-- Human-Verified is the only state carrying "Verified by our team" and the top
-- reach tier, so it is the one label a reader will act on. It requires TWO
-- DISTINCT Access subjects: one records an intent here, a different one applies
-- it and the row is removed.
--
-- With a single maintainer this is unsatisfiable, which is the CORRECT failure
-- direction: publication must fail toward not publishing. Removal stays
-- single-reviewer, so an infiltrated reviewer's maximum unilateral harm is
-- suppression — the accepted fail-safe direction.
--
-- Rows are transient by design: an intent that is never seconded simply sits
-- until swept. `first_subject` is the opaque Access subject, never an email.
-- Every filter column is indexed.
CREATE TABLE review_approvals (
	item_id TEXT NOT NULL,
	action TEXT NOT NULL,
	first_subject TEXT NOT NULL,               -- opaque Access subject
	at_bucket TEXT NOT NULL,                   -- coarse day bucket
	PRIMARY KEY (item_id, action)
	-- ABSENT BY DESIGN: no email, no display name, no precise instant, no free
	-- text. The reason a reviewer gave lives in mod_audit, truncated.
);

CREATE INDEX idx_review_approvals_bucket ON review_approvals (at_bucket);
