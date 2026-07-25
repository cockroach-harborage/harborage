<script lang="ts">
	import { acknowledge } from '$lib/briefing.svelte';
	let { topic } = $props();
</script>

<button onclick={() => acknowledge(topic)}>I have read this</button>
