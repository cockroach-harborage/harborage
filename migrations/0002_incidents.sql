-- M1: the Incident is the central primitive (PRD §2; ARCHITECTURE §4.2).
-- Public-plaintext, coarse-geo only. Written by the M2 consumer, never by a
-- hot-path request; the public browse reads a Cron-materialized index, not this
-- table directly. Structural invariants (CLAUDE.md §2): NO uploader->incident
-- edge, NO precise GPS (coarse geohash-prefix + jurisdiction bucket only), NO
-- individual identity — actor is institutional (role / unit / station / rank-band)
-- only. Individual identifiers (badge, name, plate) belong to the counsel-gated
-- accountability path (M5), never here.
CREATE TABLE incidents (
	id TEXT PRIMARY KEY,                       -- opaque ULID; no time/identity/location encoded
	type TEXT NOT NULL,                        -- closed taxonomy key (see apps/web incident-types)
	occurred_date TEXT,                        -- day granularity, YYYY-MM-DD (no precise clock time)
	time_window TEXT,                          -- coarse window label (e.g. morning / afternoon / night)
	region_bucket TEXT NOT NULL,               -- signed hierarchical region code, e.g. IN-DL, IN-PB-LDH
	coarse_geohash4 TEXT,                       -- ~20 km coarse geo; NEVER finer than this on an incident
	jurisdiction_bucket TEXT,                  -- coarse police jurisdiction bucket (institutional, not a place-of-person)
	actor_role TEXT,                           -- institutional role / rank-band only
	actor_unit TEXT,                           -- institutional unit / station only
	injuries INTEGER,                          -- reported count, nullable
	detentions INTEGER,                        -- reported count, nullable
	narrative TEXT,                            -- constrained public narrative (already scrubbed/redacted)
	verification_state TEXT NOT NULL DEFAULT 'Unverified',  -- Unverified default; never amplified
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING / PUBLIC / HIDDEN (reversible)
	created_bucket TEXT NOT NULL               -- coarse ingest day bucket (no precise submission timestamp)
	-- ABSENT BY DESIGN: no uploader/contributor id, no lat/lng, no precise ts,
	-- no individual name/phone/badge/plate. Those never exist on this table.
);

CREATE INDEX idx_incidents_type ON incidents (type);
CREATE INDEX idx_incidents_region ON incidents (region_bucket);
CREATE INDEX idx_incidents_geo ON incidents (coarse_geohash4);
CREATE INDEX idx_incidents_state ON incidents (verification_state);
CREATE INDEX idx_incidents_status ON incidents (status);
CREATE INDEX idx_incidents_date ON incidents (occurred_date);
