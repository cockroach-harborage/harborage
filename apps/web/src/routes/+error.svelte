<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
</script>

<svelte:head>
	<title>{m.error_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.error_title()}</h1>
<p>{m.error_body()}</p>
<p><a href={localizeHref('/')}>{m.nav_home()}</a></p>
