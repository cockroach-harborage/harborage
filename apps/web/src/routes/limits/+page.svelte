<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	// The honest-limits contract (CLAUDE.md §6; ARCHITECTURE §9.7). False
	// confidence gets people arrested — never soften these lines.
	const lines = [
		() => m.limits_1(),
		() => m.limits_2(),
		() => m.limits_3(),
		() => m.limits_4(),
		() => m.limits_5(),
		() => m.limits_6(),
		() => m.limits_7(),
		() => m.limits_8(),
		() => m.limits_9(),
		() => m.limits_10(),
		() => m.limits_11(),
		() => m.limits_12()
	];
</script>

<svelte:head>
	<title>{m.limits_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.limits_title()}</h1>
<p class="safety-copy">{m.limits_intro()}</p>

<div class="stack safety-copy">
	{#each lines as line, i (i)}
		<p>{line()}</p>
	{/each}
</div>
