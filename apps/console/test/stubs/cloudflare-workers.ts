/**
 * Minimal stand-in for the `cloudflare:workers` module so DO classes can be
 * unit-tested in plain Node.
 *
 * The alternative was extracting the DO's logic into a sibling module, which
 * would have moved it out of the only directory gate-memory-only scans
 * (src/do/<Class>.ts). Keeping the logic in the DO file keeps the durable-write
 * invariant enforced where it matters; this stub is what makes that testable.
 */
export class DurableObject {
	constructor(
		readonly ctx?: unknown,
		readonly env?: unknown
	) {}
}
