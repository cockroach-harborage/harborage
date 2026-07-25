// Fixture: WebSocket Hibernation attachments. serializeAttachment persists
// across eviction, so it is durable state wearing a different name — and it is
// exactly how a hibernating board would be tempted to keep its sketch.
import { DurableObject } from 'cloudflare:workers';

export class RateLimit extends DurableObject {
	async onConnect(ws: WebSocket, sketch: unknown): Promise<void> {
		ws.serializeAttachment(sketch);
	}
}
