import { DurableObject } from 'cloudflare:workers';

export class RateLimit extends DurableObject {
	private tokens = 30;

	async allow(cost = 1): Promise<boolean> {
		await this.ctx.storage.put('tokens', this.tokens);
		if (this.tokens < cost) return false;
		this.tokens -= cost;
		return true;
	}
}
