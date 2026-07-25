export async function handle({ event, resolve }) {
	const res = await resolve(event);
	res.headers.set('Content-Security-Policy', "require-trusted-types-for 'script'");
	res.headers.set('X-Content-Type-Options', 'nosniff');
	res.headers.set('Referrer-Policy', 'no-referrer');
	res.headers.set('Permissions-Policy', 'geolocation=()');
	res.headers.set('X-Frame-Options', 'DENY');
	return res;
}
