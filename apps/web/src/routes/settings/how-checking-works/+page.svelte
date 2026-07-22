<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	// The four labels, one system, everywhere the same (PRD §15). Word first;
	// colour is decoration only. Never a score, never AI machinery.
	const labels = [
		{ label: () => m.label_team(), meaning: () => m.label_team_meaning() },
		{ label: () => m.label_nearby(), meaning: () => m.label_nearby_meaning() },
		{ label: () => m.label_unchecked(), meaning: () => m.label_unchecked_meaning() },
		{ label: () => m.label_problem(), meaning: () => m.label_problem_meaning() }
	];
</script>

<svelte:head>
	<title>{m.set_checking()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_checking()}</h1>
<p class="muted">{m.checking_intro()}</p>

<div class="stack">
	{#each labels as item, i (i)}
		<div class="card">
			<span>
				<span class="card-title">{item.label()}</span><br />
				<span class="card-sub">{item.meaning()}</span>
			</span>
		</div>
	{/each}
</div>
