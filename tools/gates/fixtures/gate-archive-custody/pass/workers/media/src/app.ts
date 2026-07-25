// Fixture: the allowed shape of the master path, so the rule is exercised and
// not merely absent.
app.post('/media/master', async (c) => {
	const src = await fetch(await client.presignGet(PUBLIC_MEDIA_BUCKET, key));
	return c.json({ master: 'built' }, 200);
});

app.get('/media/other', async (c) => c.text('ok'));
