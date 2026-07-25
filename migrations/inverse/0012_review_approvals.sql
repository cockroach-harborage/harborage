-- Pre-authored inverse of 0012 (ARCHITECTURE §10.2). Applying an inverse is a
-- manual, reviewed operation — never automated.
DROP INDEX IF EXISTS idx_review_approvals_bucket;
DROP TABLE IF EXISTS review_approvals;
