# Harborage

Open web infrastructure that supports peaceful, lawful, democratic protest and human-rights documentation in India. It serves the public, protestors, people seeking help, volunteers, and provider organizations. It is neutral civic infrastructure, not the apparatus of any party or movement.

## Documents

- [PRD.md](./PRD.md) — what to build.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how it works. §18 is the authoritative reconciliation.
- [CLAUDE.md](./CLAUDE.md) — binding standards for every contributor and every AI session. Read this before writing code.
- [RUNBOOK.md](./RUNBOOK.md) — the only manual operational steps.

## Repository

pnpm monorepo. Cloudflare Workers, OpenTofu, GitHub Actions. Deploys run only from CI. See ARCHITECTURE §17 for the infrastructure rules and §18.3 for the resource manifest.

```
apps/web        Public app (SvelteKit PWA, offline-first)
apps/console    Privileged console (Cloudflare Access, hardware MFA)
workers/        Purpose-scoped Workers (api, media, consumer)
packages/       crypto (frozen), worker-lib, foundry (design tokens), outbox
content/        Reviewed source content (directives, rights, crisis cards, directory seed)
infra/          OpenTofu (Cloudflare account and zone resources)
migrations/     D1 SQL migrations, with pre-authored inverses
tools/gates/    CI enforcement gates
```

## Security

See [ARCHITECTURE.md](./ARCHITECTURE.md) §9 and the standards in [CLAUDE.md](./CLAUDE.md). Report vulnerabilities privately; a disclosure policy ships at `/.well-known/security.txt`. De-anonymization, redaction-bypass, and code-injection findings are treated as highest severity.
