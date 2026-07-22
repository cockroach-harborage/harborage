<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.notices_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.notices_title()}</h1>
<p>{m.notices_empty()}</p>
<p class="muted">{m.notices_what()}</p>
