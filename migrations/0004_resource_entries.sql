-- M1: public Resource Directory (PRD §14). Organizations / already-public
-- resources only, split by entity type. Schema-enforced invariants:
--   DIR-1: entity_type in {ORG, PUBLIC_INFRA, INITIATIVE}; NO column can hold a
--          natural-person identity, a home address, a seeker's need, or a
--          who-verified-what edge. There is no row shape for "individual X helps".
--   DIR-2: no money brokering — NO money field of any kind (no sum, no transfer,
--          no fund-routing) anywhere. Financial entries are pointers to an org's
--          own channel only.
-- Every filter column is indexed (ARCHITECTURE §4.2 schema-lint).
CREATE TABLE resource_entries (
	id TEXT PRIMARY KEY,                       -- opaque ULID (no time/identity/location encoded)
	entity_type TEXT NOT NULL,                 -- ORG | PUBLIC_INFRA | INITIATIVE  (DIR-1)
	category TEXT NOT NULL,                    -- closed signed taxonomy
	subcategory TEXT,                          -- closed signed taxonomy
	name_i18n TEXT NOT NULL,                   -- provider/org name (never a natural-person contact name)
	region_bucket TEXT NOT NULL,               -- signed region code, e.g. IN-DL, IN-PB-LDH (multi-city key)
	coarse_geohash4 TEXT NOT NULL,             -- ~20 km, always present for coarse filter
	geohash6 TEXT,                             -- NULL unless visibility_tier = PUBLIC_ADDRESS
	address_i18n TEXT,                         -- NULL unless visibility_tier = PUBLIC_ADDRESS (org premises, not a person's home)
	contact_method TEXT NOT NULL,              -- PHONE | URL | WALK_IN | IN_APP_BROKER (broker = M4 only)
	contact_value TEXT,                        -- the org's OWN published phone/URL; NULL if IN_APP_BROKER
	hours_json TEXT,                           -- structured, offline-renderable
	languages TEXT,                            -- ISO codes served, e.g. ["hi","en","pa"]
	accessibility TEXT,                        -- bitflags {wheelchair, sign_language, step_free, ...}
	visibility_tier TEXT NOT NULL DEFAULT 'PUBLIC_ADDRESS',  -- PUBLIC_ADDRESS | CONTACT_BROKERED
	verification_state TEXT NOT NULL DEFAULT 'SelfListed',   -- SelfListed|Corroborating|Verified|Signed|Stale|Quarantined
	trust_score INTEGER NOT NULL DEFAULT 0,    -- materialized 0-100 (reach earned by verification, never engagement)
	corroboration_cnt INTEGER NOT NULL DEFAULT 0,  -- distinct independent verifiers (PII-free count)
	is_core_infra INTEGER NOT NULL DEFAULT 0,  -- hand-verified seed / critical infra; NEVER community-auto-hidden
	last_verified_ts INTEGER,
	consent_ref TEXT,                          -- opaque hash of the signed provider-consent record
	status TEXT NOT NULL DEFAULT 'LIVE',       -- LIVE | HIDDEN | QUARANTINED (fail toward hidden)
	pack_epoch INTEGER NOT NULL DEFAULT 0      -- signed rollup epoch this belongs to
	-- ABSENT BY DESIGN (DIR-1/DIR-2): no owner->person map, no residence of a
	-- person, no individual_contact_name, no money field, no seeker/need
	-- linkage, no who-verified-what edge, no visitor/query log.
);

CREATE INDEX idx_resource_entity ON resource_entries (entity_type);
CREATE INDEX idx_resource_category ON resource_entries (category);
CREATE INDEX idx_resource_subcategory ON resource_entries (subcategory);
CREATE INDEX idx_resource_region ON resource_entries (region_bucket);
CREATE INDEX idx_resource_geo ON resource_entries (coarse_geohash4);
CREATE INDEX idx_resource_geo6 ON resource_entries (geohash6);
CREATE INDEX idx_resource_languages ON resource_entries (languages);
CREATE INDEX idx_resource_accessibility ON resource_entries (accessibility);
CREATE INDEX idx_resource_visibility ON resource_entries (visibility_tier);
CREATE INDEX idx_resource_state ON resource_entries (verification_state);
CREATE INDEX idx_resource_trust ON resource_entries (trust_score);
CREATE INDEX idx_resource_core ON resource_entries (is_core_infra);
CREATE INDEX idx_resource_status ON resource_entries (status);
