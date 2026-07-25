// FAIL fixture: the guard is present, but it runs SECOND.
//
// featureAvailable reads the FLAGS KV namespace, so a clearnet request to a
// life-safety route now causes a binding read before it is refused. The refusal
// still happens and every route test still sees 403, which is precisely why this
// cannot be caught by a test: the observable behaviour is identical. The timing
// of that KV read is the signal, and only a source check sees it.
import { Hono } from 'hono';
import { requireOnionOrigin } from '@harborage/worker-lib/onion';
import { featureAvailable } from '@harborage/worker-lib/flags';

export const app = new Hono();

app.post('/api/things/triage', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));

	if (!(await featureAvailable(c.env.FLAGS, 'things_broker', { disabledUnderHeightenedThreat: false })))
		return c.text('not open', 403);

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;
	return c.json({ ok: true }, 202);
});

app.get('/api/things/open', async (c) => {
	const rows = await c.env.DB.prepare('SELECT * FROM things').all();
	return c.json({ things: rows.results }, 200);
});
