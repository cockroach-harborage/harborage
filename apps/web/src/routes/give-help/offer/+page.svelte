<!--
	Offer help.

	Capacity bands appear HERE ONLY, never on a seeker's screen. A seeker told
	"many helpers here" who then finds none is worse off than one told nothing,
	and a seeker cannot act on the number anyway because the match is brokered.
	A helper can act on it: it tells them whether their offer is needed.

	Rendered as WORDS, never as a count. The API returns a band; there is no
	number to render even if this file wanted one.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SafetyBriefing from '$lib/components/SafetyBriefing.svelte';
	import { isAcknowledged } from '$lib/briefing.svelte';

	const points = [m.brief_offer_1(), m.brief_offer_2(), m.brief_offer_3(), m.brief_offer_4()];

	let bandWord = $state(m.offer_bands_hidden());

	async function loadBands() {
		try {
			const res = await fetch('/api/help/capacity');
			if (!res.ok) return;
			const body = (await res.json()) as { published?: boolean; bands?: { band?: string }[] };
			// Not published is NOT the same as NONE, so it keeps the neutral wording.
			if (!body.published) return;
			const bands = body.bands ?? [];
			if (bands.some((b) => b.band === 'MANY')) bandWord = m.offer_bands_many();
			else if (bands.some((b) => b.band === 'SOME')) bandWord = m.offer_bands_some();
			else bandWord = m.offer_bands_none();
		} catch {
			// Keep the neutral wording rather than guessing.
		}
	}
	$effect(() => {
		void loadBands();
	});
</script>

<svelte:head>
	<title>{m.offer_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.offer_title()}</h1>

{#if isAcknowledged('aid_offer')}
	<div class="stack safety-copy">
		<p>{m.offer_closed()}</p>
		<p class="muted">{bandWord}</p>
	</div>
{:else}
	<SafetyBriefing topic="aid_offer" {points} />
{/if}
