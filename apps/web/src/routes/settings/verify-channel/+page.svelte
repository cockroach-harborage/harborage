<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { PINNED_PACK_PUBKEYS } from '$lib/content-pack';

	// After the offline key ceremony this lists the pinned key fingerprints. Until
	// then it is empty, and the page says plainly that notices are not verifiable.
	const pinned = PINNED_PACK_PUBKEYS;
</script>

<svelte:head>
	<title>{m.verify_channel_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="safety-copy">{m.verify_channel_title()}</h1>

<div class="stack">
	<p class="safety-copy">{m.verify_channel_domain()}</p>
	<p class="domain"><code>cockroachharborage.org</code></p>

	{#if pinned.length === 0}
		<p class="pending safety-copy" role="status">{m.verify_channel_pending()}</p>
	{:else}
		<ul class="fingerprints">
			{#each pinned as key, i (i)}
				<li><code>{key.slice(0, 44)}</code></li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.domain code {
		font-size: var(--text-lg);
		word-break: break-all;
	}
	.pending {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: var(--sp-3);
	}
	.fingerprints {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.fingerprints code {
		word-break: break-all;
	}
</style>
