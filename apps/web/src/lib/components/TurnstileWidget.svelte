<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	/**
	 * Turnstile, rendered only when a sitekey exists (ARCHITECTURE §17.6).
	 *
	 * WHY THIS EXISTS AT ALL: `/api/incidents/register` has required a
	 * `cf-turnstile-response` header since M1, and the client never sent one.
	 * No widget existed anywhere in the app. The moment `document_intake` was
	 * switched on, every send would have returned 403 — a switch-on blocker that
	 * no test could see, because every test runs with the flag OFF.
	 *
	 * MANAGED mode, not Invisible (CLAUDE.md §5). A visitor routed through Tor or
	 * a VPN is exactly who this platform exists for, and an invisible widget
	 * fails them silently with no way to recover. A managed widget shows them a
	 * challenge they can actually solve.
	 *
	 * `feedback-enabled: false` — it defaults to TRUE and reports visitor
	 * feedback to Cloudflare on failure. Nothing about a person's failed
	 * challenge on this site should travel anywhere.
	 *
	 * FAILS CLOSED, LOUDLY. Under a strict CSP with Trusted Types enforced, a
	 * third-party script can fail in ways we do not control: a blocked load, a
	 * Trusted Types violation inside their code, a network drop on a bad link.
	 * Every one of those paths ends with no token, `ready` false, and the caller
	 * keeping the send button disabled. It never ends with a send that the server
	 * will reject.
	 */
	let {
		sitekey,
		token = $bindable(''),
		theme = 'auto'
	}: { sitekey: string; token?: string; theme?: 'auto' | 'light' | 'dark' } = $props();

	interface TurnstileApi {
		render(el: HTMLElement, opts: Record<string, unknown>): string;
		remove(id: string): void;
		reset(id: string): void;
	}

	const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

	let host: HTMLDivElement;
	let widgetId: string | null = null;
	let failed = $state(false);

	function api(): TurnstileApi | undefined {
		return (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile;
	}

	/**
	 * A Trusted Types policy that can only ever produce ONE url.
	 *
	 * `HTMLScriptElement.src` IS a TrustedScriptURL sink, and this app enforces
	 * `require-trusted-types-for 'script'` on every page. Two things follow, and
	 * both were found by running this rather than by reading it:
	 *
	 *  - Assigning a plain string to `.src` throws, so the script never loads.
	 *  - The `default` policy in pipeline-client.ts cannot rescue it: that policy
	 *    exists to let the capture Web Worker be constructed and deliberately
	 *    REJECTS cross-origin URLs, which is exactly what this one is.
	 *
	 * Relaxing the default policy to admit a third-party origin would weaken
	 * every script-URL sink in the app to buy one. Instead this is a separate,
	 * named policy that ignores its argument entirely and returns the single
	 * hardcoded constant. It cannot be used to load anything else, even if an
	 * attacker reaches it, and it is allow-listed by name in the `trusted-types`
	 * directive so injected code cannot mint a permissive policy of its own.
	 */
	interface TrustedTypesLike {
		createPolicy(
			name: string,
			rules: { createScriptURL(u: string): string }
		): { createScriptURL(u: string): string } | undefined;
	}
	let scriptUrlPolicy: { createScriptURL(u: string): string } | undefined;
	function trustedScriptUrl(): string {
		const tt = (globalThis as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
		if (!tt?.createPolicy) return SCRIPT_SRC; // no Trusted Types here; plain string is fine
		try {
			scriptUrlPolicy ??= tt.createPolicy('turnstile-script', {
				// The argument is IGNORED on purpose. This policy has exactly one
				// possible output.
				createScriptURL: () => SCRIPT_SRC
			});
			return (scriptUrlPolicy?.createScriptURL(SCRIPT_SRC) as unknown as string) ?? SCRIPT_SRC;
		} catch {
			return SCRIPT_SRC;
		}
	}

	/** Load api.js once, shared across mounts. */
	let loading: Promise<void> | null = null;
	function loadScript(): Promise<void> {
		if (api()) return Promise.resolve();
		if (loading) return loading;
		loading = new Promise<void>((resolve, reject) => {
			const el = document.createElement('script');
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(el as unknown as { src: unknown }).src = trustedScriptUrl();
			} catch {
				reject(new Error('turnstile script url refused'));
				return;
			}
			el.async = true;
			el.defer = true;
			el.addEventListener('load', () => resolve());
			el.addEventListener('error', () => reject(new Error('turnstile script blocked')));
			document.head.appendChild(el);
		});
		return loading;
	}

	onMount(() => {
		let disposed = false;
		loadScript()
			.then(() => {
				const t = api();
				if (disposed || !t || !host) {
					if (!disposed) failed = true;
					return;
				}
				widgetId = t.render(host, {
					sitekey,
					theme,
					// Flexible so it does not force a horizontal scroll on a narrow
					// phone, which no primary path may ever do.
					size: 'flexible',
					// Never report a visitor's failed challenge to Cloudflare.
					'feedback-enabled': false,
					callback: (value: string) => {
						token = value;
						failed = false;
					},
					'expired-callback': () => {
						token = '';
					},
					'error-callback': () => {
						token = '';
						failed = true;
					}
				});
			})
			.catch(() => {
				// Blocked by CSP, blocked by the network, or refused by the browser.
				// No token, so the caller keeps the send disabled.
				if (!disposed) failed = true;
			});

		return () => {
			disposed = true;
			token = '';
			const t = api();
			if (widgetId && t) {
				try {
					t.remove(widgetId);
				} catch {
					// already gone
				}
			}
			widgetId = null;
		};
	});
</script>

<div class="turnstile">
	<div bind:this={host}></div>
	{#if failed}
		<p class="muted" role="status">{m.turnstile_failed()}</p>
	{/if}
</div>

<style>
	.turnstile {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		/* Never let a third-party widget push a primary path into horizontal
		   scroll on a narrow phone. */
		max-width: 100%;
		overflow-x: auto;
	}
</style>
