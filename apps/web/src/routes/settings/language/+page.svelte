<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
</script>

<svelte:head>
	<title>{m.set_language()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_language()}</h1>

<div class="list">
	<a class="list-row" href={localizeHref('/settings/language', { locale: 'en' })} data-sveltekit-reload lang="en">
		<span class="row-label">English</span>
	</a>
	<a class="list-row" href={localizeHref('/settings/language', { locale: 'hi' })} data-sveltekit-reload lang="hi">
		<span class="row-label">हिन्दी</span>
	</a>
</div>
