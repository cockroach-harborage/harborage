# CLAUDE.md — Harborage

Guidance for Claude Code (and any AI assistant) working in this repository. Read this first.

## What this project is

**Harborage** is open-source, Cloudflare-native, GitHub-Actions-managed web infrastructure to support **peaceful, lawful, democratic protest and human-rights documentation in India** — coordination, incident/evidence documentation, medical + mutual aid, legal/accountability tracking, live ground conditions, a community feed, official signed notices, and community-led + AI-assisted fact-checking. It is **neutral civic infrastructure**, not the apparatus of any party or movement.

- **Product spec (what to build):** [PRD.md](./PRD.md) — approved features & requirements.
- **System design (how to build it):** [ARCHITECTURE.md](./ARCHITECTURE.md) — Cloudflare + GitHub Actions architecture. **§14** holds version-verified library/primitive pins and corrections (checked 2026-07-22).

Both documents are approved. Treat them as the source of truth; if you change the design, update the doc in the same commit.

## Always check for the latest versions (important)

Your training data has a cutoff, and both Cloudflare and our libraries change frequently — assume things have changed since. Do **not** rely on memory for versions, limits, pricing, model IDs, or API shapes.

- **Cloudflare:** before using or reasoning about any Cloudflare feature, primitive, limit, or price, verify it against the **live Cloudflare docs** — use the Cloudflare MCP (`search_cloudflare_documentation`) and check the **changelog** for recent updates.
- **Libraries/tools:** before adding or upgrading any dependency, check its **latest release and changelog** (npm / GitHub releases) for the current version, new capabilities, and breaking changes.
- Prefer the versions pinned in [ARCHITECTURE.md §14](./ARCHITECTURE.md), but **re-verify** them — they were current as of 2026-07-22 and will drift.
- When a doc and a live source disagree, **the live source wins** — then update the doc.

## Commit conventions

- **Commit regularly** — small, logical, descriptive commits as work progresses, not one giant commit at the end.
- **Do NOT add any attribution trailer** to commit messages — no `Co-Authored-By`, no "Generated with", no tool/agent credit. Plain, descriptive messages only.
- Branch off the default branch for non-trivial work. **Never commit secrets** (keys, tokens, `.dev.vars`, `.env`). Signing/deploy keys are generated offline and never enter the repo or CI.

## Non-negotiable principles (do not violate)

This platform holds data that can get vulnerable people arrested, surveilled, or hurt. Evaluate every change against these. If a change touches them, it needs the maintainers and, where noted, legal counsel.

1. **Peaceful & lawful.** Never build anything that facilitates violence, weapons, or incitement.
2. **Protestor safety first.** Assume a resourceful, hostile **state-level adversary** whose main power is metadata/traffic correlation. The safe path is the default. Minimize data; keep the most incriminating data **off-platform** or **client-side encrypted** so compulsion returns nothing.
3. **Three hard red lines:**
   - No public "target list" — accountability names **official-capacity** misconduct only (badge/rank/unit, via a multi-person review gate); **never** home/family/private data or calls to confront/locate/retaliate.
   - No unverified identity claims about plainclothes / "posing-as-police" individuals (misidentification harms innocents).
   - No live **individual** precise-GPS broadcast and **no persistent who-was-where-when log**. Live board is zone-level, delayed, density-floored, suppress-until-safe-density, short-TTL, memory-only.
4. **No member directory, no social/vouch graph, no real-name/phone/SIM identity, no SMS OTP** anywhere.
5. **Open-source security.** No secrets in the repo; signed, verifiable releases; pinned dependencies + action SHAs; ≥2 reviewers on sensitive paths (auth/crypto/location/evidence/CI); per-feature kill switches + heightened-threat mode.
6. **Honesty about limits.** State plainly, in-product, what the tool cannot protect against (edge/ISP metadata, targeted web code-injection, browser key custody until the signed APK, coercion).

## Build sequence

Follow [ARCHITECTURE.md §12](./ARCHITECTURE.md) build order:
**M0** foundations & integrity → **M1** signed knowledge + official notices → **M2** identity + moderation floor → **M3** evidence → **M4** brokered aid → **M5** realtime + accountability.

Every data-holding feature stays behind a kill switch + a launch-readiness gate until its prerequisite exists — offshore legal entity, offline key ceremony, off-platform custodians, and a staffed trust-&-safety org are **human/organizational blockers**, not code, and gate switch-on.

## Stack (see ARCHITECTURE.md for detail; verify versions before use)

SvelteKit (Svelte 5) + `@sveltejs/adapter-cloudflare` on **Workers Static Assets** (not Pages) · Wrangler v4 · Durable Objects (memory-only for hot-path state) · D1 · R2 · KV · Queues · Turnstile · Cloudflare Access (privileged consoles) · client-side crypto via `@noble`/`@scure` v2 + `libsodium-wrappers-sumo` · signed releases via Sigstore/cosign + minisign · GitHub Actions (build/attest/deploy split; no Cloudflare OIDC yet, so the deploy token is scoped + rotated).
