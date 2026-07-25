<!--
	Ask for food, water or supplies.

	The briefing renders INSTEAD OF the compose form. The form is absent from the
	DOM until acknowledged, which is what makes the guard provable rather than
	cosmetic, and the acknowledgement is memory-only so a reload re-arms it.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SafetyBriefing from '$lib/components/SafetyBriefing.svelte';
	import { isAcknowledged } from '$lib/briefing.svelte';

	const points = [m.brief_aid_1(), m.brief_aid_2(), m.brief_aid_3(), m.brief_aid_4()];
</script>

<svelte:head>
	<title>{m.aid_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.aid_title()}</h1>

{#if isAcknowledged('aid_need')}
	<div class="stack safety-copy">
		<p>{m.aid_closed()}</p>
		<p class="muted">{m.aid_what_happens()}</p>
		<p class="muted">{m.aid_no_map()}</p>
	</div>
{:else}
	<SafetyBriefing topic="aid_need" {points} />
{/if}
