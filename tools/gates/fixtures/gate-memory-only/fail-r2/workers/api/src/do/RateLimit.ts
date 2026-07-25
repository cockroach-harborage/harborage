// Fixture: a wholly-memory class holding an R2 bucket. Writing ciphertext to a
// bucket "just until the recipient collects it" creates a durable object with a
// timestamp recording that an exchange happened — the exact record these
// classes exist to not have.
import { DurableObject } from 'cloudflare:workers';

interface Env {
	PARCELS: R2Bucket;
}

export class RateLimit extends DurableObject<Env> {
	private tokens = 30;

	async stash(key: string, bytes: Uint8Array): Promise<void> {
		await this.env.PARCELS.put(key, bytes);
	}
}
