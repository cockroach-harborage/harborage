# Security policy

Harborage protects people at real risk. A de-anonymization, redaction-bypass,
or code-injection flaw is treated as highest severity, handled privately, with
no public window while it is weaponizable. A sensitive field reaching logs is an
incident, not a bug.

## Report privately

- GitHub private advisory: https://github.com/cockroach-harborage/harborage/security/advisories/new
- Identity-optional encrypted intake (PGP/age key and onion drop) is published
  with the first production release at `/.well-known/security.txt`.

Do not open a public issue for a security finding.

## Safe harbor

Good-faith research against your own accounts and data is welcome. Do not access
other people's data, degrade the service, or test social-engineering paths. We
will not pursue action for good-faith research within these bounds.

## Scope notes

The honest-limits contract (`/limits` in the app; ARCHITECTURE §9.7) lists what
the platform does not defend against by design. Reports that restate those
limits are still welcome when they show a stronger-than-documented impact.
