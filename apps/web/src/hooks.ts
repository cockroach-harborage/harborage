import type { Reroute } from '@sveltejs/kit';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

// URL-based locales (/ = en, /hi/... = Hindi) map onto one route tree.
export const reroute: Reroute = (request) => deLocalizeUrl(request.url).pathname;
