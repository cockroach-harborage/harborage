-- M2: Moderation audit (ARCHITECTURE §4.2, which is the single canonical
-- definition of this column set; §7.4 and the §15 purge table both point here).
--
-- NON-CONTENT BY CONSTRUCTION: never the payload, never an author, never a
-- reporter, never an IP, never a coordinate. Appeals run off these rows, and a
-- silent up-label is detectable because the log is append-only.
--
-- Custody is ENCRYPTED-AT-REST, which §4.1 rates "No — treat as compellable".
-- D1 Time Travel is ~30 days and cannot be disabled, so nothing here may be
-- described as ephemeral.
--
-- `reviewer_ref` is NULL for autonomous rows and an opaque console subject for
-- human ones. `at_bucket` is a coarse day bucket, never a precise instant: a
-- precise one would build a record of exactly when a particular reviewer acted.
-- Every filter column is indexed.
CREATE TABLE mod_audit (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	opaque_id TEXT NOT NULL,                   -- the item acted on
	category_code TEXT NOT NULL,               -- code only, never the matched text
	action TEXT NOT NULL CHECK (action IN (
		'label','rank','hide-pending','retain-pending','route-to-gate'
	)),                                        -- the fixed reversible enum (§15)
	actor_class TEXT NOT NULL CHECK (actor_class IN ('auto','human')),
	reviewer_ref TEXT,                         -- NULL for autonomous rows
	model_version TEXT,
	confidence_milli INTEGER,                  -- carries the >= 0.95 threshold rule
	prior_state TEXT,
	new_state TEXT,
	reason_code TEXT,
	at_bucket TEXT NOT NULL                    -- coarse day bucket
	-- ABSENT BY DESIGN: no payload, no author, no reporter, no address, no
	-- coordinate, no precise instant. The action enum has no publish, delete or
	-- unredact member, so no such row can ever be written.
);

CREATE INDEX idx_mod_audit_item ON mod_audit (opaque_id);
CREATE INDEX idx_mod_audit_action ON mod_audit (action);
CREATE INDEX idx_mod_audit_actor ON mod_audit (actor_class);
CREATE INDEX idx_mod_audit_bucket ON mod_audit (at_bucket);
