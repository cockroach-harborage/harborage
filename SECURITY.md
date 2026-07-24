# Security policy

Harborage protects people at real risk. A de-anonymization, redaction-bypass,
or code-injection flaw is treated as highest severity, handled privately, with
no public window while it is weaponizable. A sensitive field reaching logs is an
incident, not a bug.

## Report privately

- GitHub private advisory: https://github.com/cockroach-harborage/harborage/security/advisories/new
- **Identity-optional encrypted intake is NOT yet available.** This previously
  said it ships "with the first production release". That release has now
  happened and the channel does not exist, so the honest statement is: reporting
  today requires a GitHub account. The age/PGP key and onion drop are a tracked
  RUNBOOK step.
- If you cannot safely be identified, open the advisory from a throwaway GitHub
  account created over Tor. **Do not email us** — there is no user-facing email
  path by design, so nothing reaches a human.

Do not open a public issue for a security finding.

## Safe harbor

Good-faith research against your own accounts and data is welcome. Do not access
other people's data, degrade the service, or test social-engineering paths. We
will not pursue action for good-faith research within these bounds.

## Scope notes

The honest-limits contract (`/limits` in the app; ARCHITECTURE §9.7) lists what
the platform does not defend against by design. Reports that restate those
limits are still welcome when they show a stronger-than-documented impact.
