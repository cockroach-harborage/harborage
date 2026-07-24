<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import { crisisCard, crisisCardsSigned } from '$lib/crisis-cards';

	let { data } = $props();

	const card = $derived(crisisCard(data.card));
	// Draft until a counsel/medic-signed pack replaces the bundled content.
	const draft = !crisisCardsSigned();
</script>

<svelte:head>
	<title>{card?.title ?? m.nav_stay_safe()} · {m.app_name()}</title>
</svelte:head>

<h1 class="safety-copy">{card?.title ?? m.nav_stay_safe()}</h1>

{#if draft}
	<p class="draft-banner" role="alert">{m.card_draft_banner()}</p>
{/if}

{#if card}
	<h2 class="safety-copy">{m.card_do_now()}</h2>
	<ol class="steps">
		{#each card.steps as step, i (i)}
			<li class="safety-copy">{step}</li>
		{/each}
	</ol>

	{#if card.donts.length > 0}
		<h2 class="safety-copy">{m.card_dont()}</h2>
		<ul class="donts">
			{#each card.donts as dont, i (i)}
				<li class="safety-copy">{dont}</li>
			{/each}
		</ul>
	{/if}

	<p class="muted">{card.closing}</p>
{/if}

<div class="list">
	<a class="list-row" href={localizeHref('/stay-safe')}>
		<Icon name="shield" />
		<span class="row-label">{m.card_next_all()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/get-help')}>
		<Icon name="help" />
		<span class="row-label">{m.hero_get_help()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
</div>

<style>
	.draft-banner {
		background: var(--surface);
		border: 2px solid var(--hazard);
		border-radius: var(--r-sm);
		padding: var(--sp-3);
		color: var(--hazard);
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
	}
	.steps,
	.donts {
		padding-left: var(--sp-5);
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.steps li {
		font-weight: var(--fw-semi);
	}
</style>
