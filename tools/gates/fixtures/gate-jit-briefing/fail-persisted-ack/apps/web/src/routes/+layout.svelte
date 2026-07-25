<script lang="ts">
	import { forgetBriefing } from '$lib/briefing.svelte';
	function quickExit() {
		forgetBriefing();
		location.replace('/directory');
	}
</script>

<button onclick={quickExit}>Close</button>
