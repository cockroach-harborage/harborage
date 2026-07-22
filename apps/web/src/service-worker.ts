/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline-first service worker (ARCHITECTURE §14 decision: built-in
// $service-worker, hand-written and auditable).
//
// Rules that must hold (§17.6):
// - Precache-only. No runtime caching, so a sensitive response can never land
//   in a cache by accident. Anything not precached is network-only.
// - Never cache privileged or sensitive paths (the console is a different
//   hostname and never reaches this worker; API paths are not precached).
// - The signed {path:sha256} manifest check lands at M1 with the key ceremony;
//   until then this worker still only serves same-origin, build-listed assets.
const sw = self as unknown as ServiceWorkerGlobalScope;

import { build, files, prerendered, version } from '$service-worker';

const CACHE = `harborage-${version}`;
// Files beginning with an underscore (for example _headers) are asset-platform
// config, not servable content.
const ASSETS = [
	...build,
	...files.filter((path) => !path.split('/').pop()?.startsWith('_')),
	...prerendered
];
const ASSET_SET = new Set(ASSETS);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	if (ASSET_SET.has(url.pathname)) {
		event.respondWith(
			caches.match(url.pathname).then((cached) => cached ?? fetch(request))
		);
		return;
	}

	// Not precached: network only, with an honest offline fallback for
	// navigations (the shell shows the offline strip). Never cached.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => {
				const home = await caches.match('/');
				return home ?? Response.error();
			})
		);
	}
});
