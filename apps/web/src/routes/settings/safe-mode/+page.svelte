<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.set_safe_mode()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_safe_mode()}</h1>
<div class="stack safety-copy">
	<p>{m.set_safe_1()}</p>
	<p>{m.set_safe_2()}</p>
	<p>{m.set_safe_3()}</p>
</div>
