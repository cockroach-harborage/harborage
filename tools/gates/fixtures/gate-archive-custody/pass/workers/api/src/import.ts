// Fixture: the allowed shape of the import handler — stores a fingerprint and
// makes no outbound request.
app.post('/api/archive/import', async (c) => {
	const body = await c.req.json();
	await c.env.DB.prepare('INSERT INTO archive_source_refs (canonical_content_id) VALUES (?1)')
		.bind(body.canonical_content_id)
		.run();
	return c.json({ ok: true }, 202);
});

app.get('/api/other', async (c) => c.text('ok'));
