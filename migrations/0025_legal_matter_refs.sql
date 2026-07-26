-- M5: legal matter deadline references (PRD §4.11; ARCHITECTURE §8.3).
--
-- CUSTODY CLASS: OPAQUE-REF ONLY. Everything identifying about a matter — who was
-- detained, where, the charge, the lawyer — stays OFF-PLATFORM on the lawyer's
-- side. This table holds a hash, an hour, and a kind.
--
-- THE DEADLINE IS AN HOUR, NOT A TIMESTAMP, AND THAT IS THE POINT OF THIS FILE.
-- An Article 22 production deadline is arrest time plus twenty-four hours. Stored
-- to the second, `next_deadline_ms` IS AN ARREST TIMESTAMP: subtract 24 hours and
-- you have the minute a named person was taken, for every row in the table. D1
-- Time Travel is ~30 days and cannot be disabled, so a compelled restore hands
-- that over even after we delete it.
--
-- Hour granularity costs nothing — the lead time on these reminders is hours, not
-- seconds — and it removes the arrest minute. A compelled restore then yields
-- {opaque hash, hour, kind}, which is the floor for any server-side reminder at
-- all.
--
-- THE ON-DEVICE CALENDAR IS PRIMARY. This table buys exactly one thing over a
-- reminder in the lawyer's own phone: a deadline that survives that phone being
-- seized, lost, or dead. Say that plainly rather than implying it is the system of
-- record.
--
-- ABSENT BY DESIGN: no detainee name, no lawyer name, no station, no charge, no
-- case number, no court, no phone, no address, no free text, no notes. `ref_hash`
-- is opaque and is computed off-platform; the platform cannot invert it and has no
-- table to join it against.
--
-- ZERO ROWS AT REST. detainee_intake is LOCKED with no FLAG_NAMES entry, so no
-- Worker code that consults it typechecks and no route can write here.
CREATE TABLE legal_matter_refs (
	ref_hash TEXT PRIMARY KEY,                 -- opaque, computed off-platform
	-- Closed kinds. A free-text kind would carry the charge.
	kind TEXT NOT NULL CHECK (kind IN ('production', 'bail_hearing', 'remand_review', 'filing')),
	-- HOURS since the epoch. Never milliseconds, never a date-time string.
	next_deadline_hour INTEGER NOT NULL,
	-- Set by the alarm. The platform never notifies anyone; it only marks.
	fired INTEGER NOT NULL DEFAULT 0 CHECK (fired IN (0, 1)),
	-- Which DeadlineTimer shard owns this row, derived from ref_hash.
	shard INTEGER NOT NULL CHECK (shard >= 0 AND shard < 16),
	created_hour INTEGER NOT NULL
	-- ABSENT BY DESIGN: see the header. Adding any identifying column here moves
	-- the matter itself onto the platform, which §8.3 puts behind counsel.
);

CREATE INDEX idx_legal_refs_shard ON legal_matter_refs (shard);
CREATE INDEX idx_legal_refs_due ON legal_matter_refs (next_deadline_hour);
CREATE INDEX idx_legal_refs_fired ON legal_matter_refs (fired);
