<!--
	An honest refusal, not a "coming soon".

	The medical broker is dark for everyone: the routes refuse over clearnet, no
	onion origin is operated, the flag is off, and the inbox MAC key is absent.
	Four independent reasons. So this page does not offer a compose form it cannot
	honour, and it does not pretend the feature is nearly here.

	NO STATE EMERGENCY NUMBER (maintainer decision, 2026-07-26). India's
	integrated line answers at a police control room, so on a platform whose
	stated adversary is the state, offering it routes a protestor to the
	adversary. The fact is stated once; what to do with it is theirs.

	THE DIRECTORY LINK IS CONDITIONAL, and that is the honest part. It renders only
	when the already-downloaded pack actually holds a medical place. Production D1
	has zero rows, so today the page says so rather than linking to an empty
	screen. A link to nothing is a dead end wearing a link.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * Client-side check over content this device already has. No server query, so
	 * nothing records that somebody in this area is looking for a medic.
	 */
	let hasMedicalPlace = $state(false);

	async function checkPack() {
		try {
			const res = await fetch('/api/directory/pack');
			if (!res.ok) return;
			const body = (await res.json()) as {
				entries?: { category?: string; subcategory?: string }[];
			};
			hasMedicalPlace = (body.entries ?? []).some(
				(e) => e.category === 'MEDICAL' || e.subcategory === 'aid_station'
			);
		} catch {
			// Offline or unreachable. The page still says the true thing.
		}
	}
	$effect(() => {
		void checkPack();
	});
</script>

<svelte:head>
	<title>{m.med_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.med_title()}</h1>

<div class="stack safety-copy">
	<p>{m.med_closed_1()}</p>
	<p>{m.med_closed_2()}</p>
	<p class="muted">{m.med_why()}</p>
	<p class="muted">{m.med_state_numbers()}</p>
</div>

{#if hasMedicalPlace}
	<div class="list">
		<a class="list-row" href={localizeHref('/directory')}>
			<Icon name="help" />
			<span class="row-label">{m.med_stations()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</a>
	</div>
{:else}
	<p class="muted safety-copy">{m.med_stations_none()}</p>
{/if}

<p class="muted safety-copy">{m.med_when()}</p>
