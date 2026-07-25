<!--
	PASS fixture. The form is ABSENT until acknowledged, and the guard nests an
	inner {#if} so the depth-counting range scan is actually exercised: a naive
	scan that stopped at the first {/if} would put the form outside the range.
-->
<script lang="ts">
	import SafetyBriefing from '$lib/components/SafetyBriefing.svelte';
	import { isAcknowledged } from '$lib/briefing.svelte';
	let ready = $state(false);
</script>

{#if !isAcknowledged('aid_need')}
	<SafetyBriefing topic="aid_need" />
{/if}

<!-- The "disabled button" version. Still a button, one console line from
     working, and toBeHidden() cannot tell it from an absent one. -->
<form method="POST">
	<button type="submit" disabled={!isAcknowledged('aid_need')}>Send</button>
</form>
