app.use('*', async (c, next) => {
	await next();
	c.header(
		'Content-Security-Policy',
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
	);
});
