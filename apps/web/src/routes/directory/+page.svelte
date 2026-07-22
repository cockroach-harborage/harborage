<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	const categories = [
		() => m.dir_mental(),
		() => m.dir_legal(),
		() => m.dir_medical(),
		() => m.dir_safe(),
		() => m.dir_journalists(),
		() => m.dir_rights_orgs(),
		() => m.dir_food(),
		() => m.dir_stay(),
		() => m.dir_relief(),
		() => m.dir_disability()
	];
</script>

<svelte:head>
	<title>{m.nav_directory()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_directory()}</h1>
<p class="muted">{m.directory_empty()}</p>

<ul class="stack" style="list-style: none; padding: 0">
	{#each categories as category, i (i)}
		<li class="card"><span class="card-title">{category()}</span></li>
	{/each}
</ul>
