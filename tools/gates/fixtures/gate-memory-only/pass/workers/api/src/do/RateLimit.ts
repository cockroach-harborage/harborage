// Fixture: the shape the gate is meant to ALLOW. A wholly-memory class may hold
// in-process state, accept a WebSocket, and schedule with setTimeout — none of
// which survives eviction, which is the whole point. Without this the gate's
// permissiveness would be untested and a stricter matcher could quietly ban
// something legitimate.
import { DurableObject } from 'cloudflare:workers';

export class RateLimit extends DurableObject {
	private tokens = 30;
	private seen = new Map<string, number>();
	private sockets = new Set<WebSocket>();

	async allow(cost = 1): Promise<boolean> {
		if (this.tokens < cost) return false;
		this.tokens -= cost;
		return true;
	}

	async watch(ws: WebSocket): Promise<void> {
		this.sockets.add(ws);
		// A tick grid computed in memory, since a wholly-memory class cannot arm
		// a durable alarm: setAlarm() bills as a row written, so an alarm IS
		// durable state and records that something is pending at time T.
		setTimeout(() => this.seen.clear(), 15_000);
	}
}
