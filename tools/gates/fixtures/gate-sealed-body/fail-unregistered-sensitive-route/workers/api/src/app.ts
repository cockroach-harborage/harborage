// PASS fixture. A real-looking router, not a route table, because the
// sensitive-prefix rule splits router text into handler blocks and a plain
// object contains none. With the old shape that rule matched nothing, and a
// pass tree that cannot exercise a rule cannot prove it works.
//
// Three routes under the sensitive prefix, covering all three outcomes: one
// registered SEALED-TO-PLATFORM, one registered SEALED-E2E, one exempt.
import { Hono } from 'hono';

export const app = new Hono();

app.post('/api/things/register', async (c) => {
	return c.json({ ok: true }, 202);
});

app.post('/api/things/keyring', async (c) => {
	return c.json({ ok: true }, 202);
});

// Carries no counterparty ciphertext, so it sits in unsealed_exempt rather than
// claiming a custody class it could not honour.
app.post('/api/things/ping', async (c) => {
	return c.json({ ok: true }, 202);
});

// FAIL fixture: a route under the sensitive prefix that is in neither
// "endpoints" nor "unsealed_exempt". Before the prefix rule existed, this was
// invisible: the gate only ever checked the entries it already had, so adding a
// plaintext intake beside the sealed ones raised nothing.
app.post('/api/things/leak', async (c) => {
	const body = await c.req.json();
	await c.env.DB.prepare('INSERT INTO things (note) VALUES (?1)').bind(body.note).run();
	return c.json({ ok: true }, 202);
});
