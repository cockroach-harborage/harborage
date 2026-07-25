-- M4: brokered helper offers (PRD §4.9; CLAUDE.md "Resource Directory standards").
--
-- CUSTODY CLASS: pseudonymous, COUNT-ONLY. This table exists so a Cron sweep can
-- turn offers into a coarse band. It is never read row by row, and it holds
-- nothing from which a person could be reached.
--
-- THAT RULES OUT MORE THAN A PHONE NUMBER. A broker inbox handle is a way to
-- reach someone. A stable badge or issuer reference is a durable per-person row
-- that survives every epoch. Neither is here. Routing happens entirely in the
-- memory-only Broker, which persists nothing; this table only counts.
--
-- WHY dedup_token IS LOAD-BEARING. Without it one person posts fifty offers and
-- the published band reads MANY where there is one. A band that lies sends
-- someone to a district with no help, which is worse than showing nothing. The
-- token is a one-way MAC under a salt scoped to (region_bucket, skill,
-- offer_epoch), so the same helper in two districts, two skills, or two epochs
-- produces unlinkable values, and no route accepts it as an input. It is a
-- de-duplicator, not an address.
--
-- THERE IS NO ACCOMMODATION SKILL, and the CHECK below is what keeps it that
-- way. PRD §4.8's interlock is that short-term housing is brokered only through
-- vetted institutional shelters, never stranger-to-home. A closed vocabulary
-- with no word for the latter is cheaper and more durable than a rule about it:
-- housing is admitted only as an organisation in resource_entries with
-- entity_type='ORG'. There is no row shape here for "this person will host you."
--
-- Every filter column is indexed (ARCHITECTURE §4.2).
CREATE TABLE skills_registry (
	id TEXT PRIMARY KEY,                       -- opaque ULID; no time or identity encoded
	region_bucket TEXT NOT NULL,               -- signed district code, e.g. IN-PB-LDH
	skill TEXT NOT NULL CHECK (skill IN (
		'legal_aid',
		'medical_first_aid',
		'counselling',
		'translation',
		'journalism_intake',
		'accessibility_support',
		'transport_public',
		'supplies',
		'documentation'
	)),
	tier TEXT NOT NULL DEFAULT 'BASIC' CHECK (tier IN ('BASIC','HIGH')),
	languages TEXT,                            -- ISO codes, e.g. ["hi","en"]
	accessibility TEXT,                        -- bitflags, same vocabulary as resource_entries
	offer_epoch INTEGER NOT NULL,              -- coarse rotation period, never a timestamp
	dedup_token TEXT NOT NULL,                 -- one-way MAC; see above. Not an address.
	status TEXT NOT NULL DEFAULT 'HIDDEN' CHECK (status IN ('HIDDEN','LIVE','WITHDRAWN')),
	expires_epoch INTEGER NOT NULL,
	created_bucket TEXT NOT NULL,              -- coarse day bucket
	UNIQUE (region_bucket, skill, offer_epoch, dedup_token)
	-- ABSENT BY DESIGN: no name of a person, no phone, no email, no residence of
	-- a person, no coordinates, no geography finer than the district code, no
	-- inbox handle, no public key, no badge or issuer id, no who-vetted-whom
	-- edge, no seeker linkage, no match record, no money field, no free text.
	-- There is nothing here from which a person could be reached.
);

CREATE INDEX idx_skills_region ON skills_registry (region_bucket);
CREATE INDEX idx_skills_skill ON skills_registry (skill);
CREATE INDEX idx_skills_tier ON skills_registry (tier);
CREATE INDEX idx_skills_lang ON skills_registry (languages);
CREATE INDEX idx_skills_access ON skills_registry (accessibility);
CREATE INDEX idx_skills_epoch ON skills_registry (offer_epoch);
CREATE INDEX idx_skills_status ON skills_registry (status);
CREATE INDEX idx_skills_expires ON skills_registry (expires_epoch);
CREATE INDEX idx_skills_created ON skills_registry (created_bucket);
