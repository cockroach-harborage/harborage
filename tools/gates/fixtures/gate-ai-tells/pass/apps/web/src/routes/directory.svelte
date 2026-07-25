<!--
	A directory card. The pass tree EXERCISES the source rule rather than merely
	avoiding it: the number comes from a signed directory row through a variable
	href, which is the one shape of dial link that is allowed. If the gate ever
	starts matching this, it has become unusable and someone will weaken it.
-->
<script lang="ts">
	let { entry } = $props();
</script>

<a class="list-row" href={`tel:${entry.contact_value}`}>
	<span class="row-label">{entry.name}</span>
</a>
