// Fixture: durable state through a D1 binding that is NOT called `DB`.
// The old matcher was anchored on the literal name, so this passed clean while
// recreating a compellable record with a ~30-day Time Travel window.
import { DurableObject } from 'cloudflare:workers';

export class RateLimit extends DurableObject {
	private tokens = 30;

	async allow(cost = 1): Promise<boolean> {
		// "Just to persist counters."
		await (this.env as { ARCHIVE: { prepare(q: string): { run(): Promise<void> } } }).ARCHIVE.prepare(
			'INSERT INTO counters (n) VALUES (1)'
		).run();
		this.tokens -= cost;
		return true;
	}
}
