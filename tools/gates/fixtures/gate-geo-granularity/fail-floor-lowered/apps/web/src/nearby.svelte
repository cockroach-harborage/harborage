<!--
	PASS fixture. A zone is CHOSEN from a signed list, never derived from where the
	device is. The comment names navigator.geolocation and getCurrentPosition on
	purpose, so the comment-stripping is exercised rather than assumed.
-->
<script lang="ts">
	let { zones } = $props();
	let zoneId = $state('');
</script>

<select bind:value={zoneId}>
	{#each zones as zone (zone.id)}
		<option value={zone.id}>{zone.label}</option>
	{/each}
</select>
