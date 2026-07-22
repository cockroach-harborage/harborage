<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.nav_nearby()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_nearby()}</h1>
<p>{m.nearby_empty()}</p>
<p class="muted">{m.nearby_how()}</p>
