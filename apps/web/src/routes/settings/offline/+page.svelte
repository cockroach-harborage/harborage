<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.set_offline()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_offline()}</h1>
<div class="stack">
	<p>{m.set_offline_1()}</p>
	<p>{m.set_offline_2()}</p>
</div>
