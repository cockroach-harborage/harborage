<!--
	PASS fixture. A zone is CHOSEN from a signed list, never derived from where the
	device is. The comment names navigator.geolocation and getCurrentPosition on
	purpose, so the comment-stripping is exercised rather than assumed.
-->
<script lang="ts">
	let { zones } = $props();
	let zoneId = $state('');

	// A "find my area" button. One line, typechecks, breaks no test, and it is a
	// self-location primitive on a platform that must not have one.
	async function findMyArea() {
		navigator.geolocation.getCurrentPosition((pos) => {
			zoneId = nearestZone(pos.coords.latitude, pos.coords.longitude);
		});
	}
</script>

<select bind:value={zoneId}>
	{#each zones as zone (zone.id)}
		<option value={zone.id}>{zone.label}</option>
	{/each}
</select>
