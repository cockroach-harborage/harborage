-- Pre-authored inverse of 0003 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_evidence_redaction;
DROP INDEX IF EXISTS idx_evidence_canonical;
DROP INDEX IF EXISTS idx_evidence_original;
DROP INDEX IF EXISTS idx_evidence_incident;
DROP TABLE IF EXISTS evidence_refs;
