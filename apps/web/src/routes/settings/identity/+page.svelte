<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.set_identity()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_identity()}</h1>
<div class="stack safety-copy">
	<p>{m.set_identity_1()}</p>
	<p>{m.set_identity_2()}</p>
	<p>{m.set_identity_3()}</p>
	<p>{m.set_identity_4()}</p>
	<p>{m.set_identity_5()}</p>
</div>
