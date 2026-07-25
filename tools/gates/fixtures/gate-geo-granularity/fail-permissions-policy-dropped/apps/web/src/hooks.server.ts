// PASS fixture. The required PRESENCE: denying geolocation at the browser is
// what also covers injected script, which a source ban cannot.
export async function handle({ event, resolve }) {
	const response = await resolve(event);
	response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self)');
	return response;
}
