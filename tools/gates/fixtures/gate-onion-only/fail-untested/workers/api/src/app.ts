// PASS fixture. TWO handlers, deliberately.
//
// A one-handler pass tree would satisfy every check while never exercising the
// block split, which is the whole point of the gate. Here /api/things/triage is
// onion-only and /api/things/open is not, so the splitter has to attribute the
// guard to the right one. If handlerBlocks() ever regressed to whole-file
// matching, fail-unguarded/ would go green and gate-selftest would catch it.
import { Hono } from 'hono';
import { requireOnionOrigin } from '@harborage/worker-lib/onion';
import { featureAvailable } from '@harborage/worker-lib/flags';

export const app = new Hono();

app.post('/api/things/triage', async (c) => {
	// Header-only checks first. Neither touches a binding, and the origin
	// assertion is computed over the body, so the body has to be read.
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));

	// ORIGIN FIRST. Nothing above this line reads c.env.
	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	if (!(await featureAvailable(c.env.FLAGS, 'things_broker', { disabledUnderHeightenedThreat: false })))
		return c.text('not open', 403);
	return c.json({ ok: true }, 202);
});

// Not a life-safety route, so not guarded and not registered. Its presence is
// what makes the pass tree a real test of the split rather than a formality.
app.get('/api/things/open', async (c) => {
	const rows = await c.env.DB.prepare('SELECT * FROM things').all();
	return c.json({ things: rows.results }, 200);
});
