-- M0: D1 mirror of the FlagState DO audit log (source of truth is the DO).
-- Staff-pseudonym rows only: actor is the opaque Access subject id.
CREATE TABLE feature_flag_audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	at TEXT NOT NULL,
	name TEXT NOT NULL,
	action TEXT NOT NULL,
	actor TEXT NOT NULL,
	reason TEXT NOT NULL
);

CREATE INDEX idx_feature_flag_audit_at ON feature_flag_audit (at);
CREATE INDEX idx_feature_flag_audit_name ON feature_flag_audit (name);
