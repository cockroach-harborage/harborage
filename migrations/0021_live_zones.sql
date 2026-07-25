-- M5: the signed list of publishable zones (ARCHITECTURE §6.3, §6.4; PRD §4.5).
--
-- CUSTODY CLASS: PUBLIC-PLAINTEXT, and deliberately almost empty.
--
-- A ZONE IS A NAME ON A SIGNED LIST, NOT A COMPUTED CELL. The id is opaque
-- (IN-DL-z0417), and it encodes nothing: no geohash, no centroid, no radius, no
-- polygon. The cell it corresponds to lives on the paper map the publisher used
-- and nowhere in this database, so no query here can be turned into a position.
--
-- WHY OPAQUE RATHER THAN A GEOHASH PREFIX. A geohash in the id would serve no
-- client purpose. Sorting zones by proximity requires the client to know its own
-- position, and there is no self-location primitive on this platform
-- (gate-geo-granularity refuses one). So the geohash would be a coordinate the
-- schema carries for nobody, and coordinates the schema carries are coordinates
-- a later query uses.
--
-- THERE IS NO latLngToZone() ANYWHERE, and that is the point of this shape: if
-- no coordinate-to-zone function exists, no client can be tricked into computing
-- one, and no compelled Worker can be asked to.
--
-- ZERO ROWS AT REST. The table ships empty, so `active = 1` matches nothing and
-- every ingest refuses today. Same structural switch-on gate as
-- PINNED_CUSTODIAN_KEYS and PINNED_VETTING_ISSUERS: the thing stopping this
-- shipping early is an absent row, not a setting.
-- Every filter column is indexed.
CREATE TABLE live_zones (
	zone_id TEXT PRIMARY KEY,                  -- opaque. NOT derivable from a position.
	region_bucket TEXT NOT NULL,               -- signed district code, e.g. IN-PB-LDH
	label_key TEXT NOT NULL,                   -- i18n key for the human place name
	list_epoch INTEGER NOT NULL,               -- which signed list this row belongs to
	list_signature TEXT NOT NULL,              -- m-of-n over the canonical list at that epoch
	active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
	-- ABSENT BY DESIGN: no lat, no lng, no geohash of any precision, no radius,
	-- no centroid, no polygon, no bounding box, no capacity, no population, no
	-- link to any signal or reporter. A row says only that a name is publishable.
);

CREATE INDEX idx_live_zones_region ON live_zones (region_bucket);
CREATE INDEX idx_live_zones_epoch ON live_zones (list_epoch);
CREATE INDEX idx_live_zones_active ON live_zones (active);
