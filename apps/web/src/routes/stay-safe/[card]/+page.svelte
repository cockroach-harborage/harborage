<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let { data } = $props();

	// One canonical version of each card, two-person reviewed, ships with the
	// M1 signed content pack (content/crisis-cards/). Until that review is done,
	// no safety instructions appear here — a wrong step is worse than none.
	const titles = {
		teargas: () => m.card_teargas(),
		detained: () => m.card_detained(),
		blackout: () => m.card_blackout(),
		peaceful: () => m.card_peaceful(),
		rights: () => m.card_rights()
	} as const;
</script>

<svelte:head>
	<title>{titles[data.card]()} · {m.app_name()}</title>
</svelte:head>

<h1 class="safety-copy">{titles[data.card]()}</h1>

<p class="safety-copy">{m.staysafe_pending()}</p>
<p class="safety-copy">{m.staysafe_pending_2()}</p>
