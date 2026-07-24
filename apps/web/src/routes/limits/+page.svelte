<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { loadCanary } from '$lib/canary';
	import type { CanaryState } from '@harborage/crypto/canary';

	// Warrant-canary signal. `ok` only when a fresh signature verifies against the
	// pinned key; anything else is a protective posture (ARCHITECTURE §10.4).
	let canaryState = $state<CanaryState | null>(null);
	const canaryText = $derived(
		canaryState === 'ok'
			? m.canary_ok()
			: canaryState === 'unestablished'
				? m.canary_pending()
				: canaryState
					? m.canary_unconfirmed()
					: ''
	);
	onMount(async () => {
		canaryState = (await loadCanary(Date.now())).state;
	});

	// The honest-limits contract (CLAUDE.md §6; ARCHITECTURE §9.7). False
	// confidence gets people arrested — never soften these lines.
	const lines = [
		() => m.limits_1(),
		() => m.limits_2(),
		() => m.limits_3(),
		() => m.limits_4(),
		() => m.limits_5(),
		() => m.limits_6(),
		() => m.limits_7(),
		() => m.limits_8(),
		() => m.limits_9(),
		() => m.limits_10(),
		() => m.limits_11(),
		() => m.limits_12()
	];
</script>

<svelte:head>
	<title>{m.limits_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.limits_title()}</h1>
<p class="safety-copy">{m.limits_intro()}</p>

{#if canaryState}
	<p class="canary" class:alert={canaryState !== 'ok'} role="status">
		<strong>{m.canary_label()}:</strong>
		{canaryText}
	</p>
{/if}

<div class="stack safety-copy">
	{#each lines as line, i (i)}
		<p>{line()}</p>
	{/each}
</div>

<style>
	.canary {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: var(--sp-2) var(--sp-3);
		font-size: var(--text-sm);
	}
	.canary.alert {
		border: 2px solid var(--hazard);
		color: var(--hazard);
	}
</style>
