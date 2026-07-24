-- M1: Cron-materialized public read model for the incident browse (ARCHITECTURE
-- §12 "Session 2.7", §4.2). Rebuilt hourly by workers/api scheduled() from
-- `incidents`, holding ONLY the public-plaintext subset of admitted rows
-- (Verified / Community-Corroborated, status PUBLIC). The client fetches this
-- whole pack and filters/searches locally, so there is NO query logging.
-- Coarse geo only; institutional actor only (no individual identity).
-- Only Human-Verified / Community-Corroborated land here (the §15 canonical
-- states); Unverified is never public.
CREATE TABLE incident_public_index (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	occurred_date TEXT,
	region_bucket TEXT NOT NULL,
	coarse_geohash4 TEXT,
	actor_role TEXT,
	actor_unit TEXT,
	injuries INTEGER,
	detentions INTEGER,
	narrative TEXT,
	verification_state TEXT NOT NULL,      -- Human-Verified / Community-Corroborated only
	corroboration_count INTEGER NOT NULL DEFAULT 0,
	built_bucket TEXT NOT NULL             -- coarse rebuild day
);

CREATE INDEX idx_ipi_type ON incident_public_index (type);
CREATE INDEX idx_ipi_region ON incident_public_index (region_bucket);
CREATE INDEX idx_ipi_state ON incident_public_index (verification_state);
CREATE INDEX idx_ipi_date ON incident_public_index (occurred_date);
