// Fixture: the master path reading the sealed vault, which this Worker cannot
// read and must never try to.
app.post('/media/master', async (c) => {
	const src = await fetch(await client.presignGet(EVIDENCE_VAULT_BUCKET, key));
	return c.json({ master: 'built' }, 200);
});

app.get('/media/other', async (c) => c.text('ok'));
