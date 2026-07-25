// FAIL fixture: THE SABOTAGE-SHAPED ONE.
//
// The guard has been deleted from /api/things/triage, the registered life-safety
// route, and now sits only in /api/things/open next door. The file still
// contains the string "requireOnionOrigin", so a whole-file
// `text.includes('requireOnionOrigin')` gate reports this as guarded.
//
// If this fixture ever goes GREEN, handlerBlocks() has regressed to whole-file
// matching and the gate can no longer tell a guarded route from a route whose
// neighbour is guarded. That is exactly the failure the block split exists to
// catch, so treat a green here as a broken gate, never as a fixture to update.
import { Hono } from 'hono';
import { requireOnionOrigin } from '@harborage/worker-lib/onion';
import { featureAvailable } from '@harborage/worker-lib/flags';

export const app = new Hono();

app.post('/api/things/triage', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	const raw = new Uint8Array(await c.req.arrayBuffer());

	if (!(await featureAvailable(c.env.FLAGS, 'things_broker', { disabledUnderHeightenedThreat: false })))
		return c.text('not open', 403);
	return c.json({ ok: true, size: raw.length }, 202);
});

app.get('/api/things/open', async (c) => {
	const bodyHash = new Uint8Array(32);
	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;
	return c.json({ things: [] }, 200);
});
