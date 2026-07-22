<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.nav_record()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_record()}</h1>
<p class="safety-copy">{m.record_keep()}</p>
<p class="safety-copy">{m.record_location_note()}</p>
<p class="muted">{m.record_pending()} {m.opens_after_checks()}</p>
