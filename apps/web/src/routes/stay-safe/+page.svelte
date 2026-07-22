<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';

	const cards = [
		{ slug: 'teargas', label: () => m.card_teargas() },
		{ slug: 'detained', label: () => m.card_detained() },
		{ slug: 'blackout', label: () => m.card_blackout() },
		{ slug: 'peaceful', label: () => m.card_peaceful() },
		{ slug: 'rights', label: () => m.card_rights() }
	];
</script>

<svelte:head>
	<title>{m.nav_stay_safe()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_stay_safe()}</h1>

<div class="stack">
	{#each cards as card (card.slug)}
		<a class="card" href={localizeHref(`/stay-safe/${card.slug}`)}>
			<Icon name="shield" size={28} />
			<span class="card-title safety-copy">{card.label()}</span>
		</a>
	{/each}
</div>

<div class="list">
	<a class="list-row" href={localizeHref('/stay-safe/notices')}>
		<Icon name="book" />
		<span class="row-label">{m.notices_title()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
</div>
