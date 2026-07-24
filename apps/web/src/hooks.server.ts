import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { safeLog, statusClass } from '@harborage/worker-lib/safe-log';

const paraglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.locale%', locale)
		});
	});

// Security-header baseline for dynamic responses (ARCHITECTURE §17.5).
// Prerendered pages (nearly all traffic here) get the baseline + a CSP with
// `require-trusted-types-for 'script'` from static/_headers, and their script-src
// CSP from the kit.csp meta tag. Trusted Types is now enforced on BOTH paths and
// gate-csp checks both. (The app is verified Trusted-Types-clean at runtime by
// the qa-sweep + csp e2e; there are no @html/innerHTML sinks.)
const security: Handle = async ({ event, resolve }) => {
	const started = Date.now();
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'geolocation=(), camera=(self), microphone=(self)');
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.append('Content-Security-Policy', "require-trusted-types-for 'script'");
	safeLog('request', {
		route: event.route.id ?? 'unknown',
		statusClass: statusClass(response.status),
		ms: Date.now() - started
	});
	return response;
};

export const handle = sequence(paraglide, security);
