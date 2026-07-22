<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';

	const rows = [
		{ href: '/settings/language', icon: 'globe', label: () => m.set_language() },
		{ href: '/settings/text-size', icon: 'gear', label: () => m.set_text_size() },
		{ href: '/settings/identity', icon: 'shield', label: () => m.set_identity() },
		{ href: '/settings/safe-mode', icon: 'shield', label: () => m.set_safe_mode() },
		{ href: '/settings/offline', icon: 'compass', label: () => m.set_offline() },
		{ href: '/settings/how-checking-works', icon: 'book', label: () => m.set_checking() }
	];
</script>

<svelte:head>
	<title>{m.settings()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.settings()}</h1>

<div class="list">
	{#each rows as row (row.href)}
		<a class="list-row" href={localizeHref(row.href)}>
			<Icon name={row.icon} />
			<span class="row-label">{row.label()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</a>
	{/each}
</div>
