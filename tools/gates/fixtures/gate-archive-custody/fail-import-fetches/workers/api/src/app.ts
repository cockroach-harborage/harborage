// Fixture: the import handler reaching out. Re-hosting is counsel-gated and the
// off-platform egress that would make it safe does not exist.
app.post('/api/archive/import', async (c) => {
	const body = await c.req.json();
	const upstream = await fetch(body.url);
	return c.json({ ok: upstream.ok }, 202);
});

app.get('/api/other', async (c) => c.text('ok'));
