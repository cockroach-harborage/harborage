<!--
	The just-in-time safety briefing.

	Renders INSTEAD OF a compose form, never beside it and never as a disabled
	overlay. The form must be ABSENT FROM THE DOM until this is acknowledged,
	which is what a gate can prove and what `toHaveCount(0)` can assert. A
	disabled button is still a button someone can re-enable from the console.

	A component and not a route, deliberately. A `/briefing` route is bookmarkable
	and therefore skippable, and a `+layout.ts` guard runs during prerender where
	there is no session at all.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { acknowledge, type BriefingTopic } from '$lib/briefing.svelte';

	let { topic, points }: { topic: BriefingTopic; points: string[] } = $props();
</script>

<section class="stack safety-copy" aria-labelledby="brief-title">
	<h2 id="brief-title">{m.brief_title()}</h2>
	<ul>
		{#each points as point (point)}
			<li>{point}</li>
		{/each}
	</ul>
	<p class="muted">{m.brief_again()}</p>
	<button class="hero-primary" onclick={() => acknowledge(topic)}>{m.brief_ack()}</button>
</section>
