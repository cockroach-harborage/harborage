<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';

	const cards = [
		{
			href: '/stay-safe',
			icon: 'shield',
			title: () => m.nav_stay_safe(),
			sub: () => m.card_stay_safe_sub()
		},
		{
			href: '/nearby',
			icon: 'compass',
			title: () => m.nav_nearby(),
			sub: () => m.card_nearby_sub()
		},
		{
			href: '/directory',
			icon: 'book',
			title: () => m.nav_directory(),
			sub: () => m.card_directory_sub()
		}
	];
</script>

<svelte:head>
	<title>{m.app_name()}</title>
	<meta name="description" content={m.home_tagline()} />
</svelte:head>

<h1 class="visually-hidden">{m.app_name()}</h1>
<p class="notice-line">{m.home_tagline()}</p>

<a class="hero hero-primary" href={localizeHref('/get-help')}>
	<span class="hero-title"><Icon name="help" size={32} />{m.hero_get_help()}</span>
	<span class="hero-sub">{m.hero_get_help_sub()}</span>
</a>

<a class="hero hero-secondary" href={localizeHref('/record')}>
	<span class="hero-title"><Icon name="camera" size={32} />{m.hero_document()}</span>
	<span class="hero-sub">{m.hero_document_sub()}</span>
</a>

<a class="hero hero-secondary" href={localizeHref('/give-help')}>
	<span class="hero-title"><Icon name="offer" size={32} />{m.hero_give_help()}</span>
	<span class="hero-sub">{m.hero_give_help_sub()}</span>
</a>

<div class="stack">
	{#each cards as card (card.href)}
		<a class="card" href={localizeHref(card.href)}>
			<Icon name={card.icon} size={28} />
			<span>
				<span class="card-title">{card.title()}</span><br />
				<span class="card-sub">{card.sub()}</span>
			</span>
		</a>
	{/each}
</div>
