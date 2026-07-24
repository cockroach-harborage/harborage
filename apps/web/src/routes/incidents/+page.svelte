<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import VerificationChip from '$lib/components/VerificationChip.svelte';
	import { INCIDENT_TYPES, incidentTypeLabel, isIncidentType, type IncidentType } from '$lib/incident-types';
	import { incidentLabelKind } from '$lib/verification';
	import { regionLabel, regionState } from '$lib/region';

	interface PublicIncident {
		id: string;
		type: string;
		occurred_date?: string;
		region_bucket: string;
		actor_role?: string;
		actor_unit?: string;
		injuries?: number;
		detentions?: number;
		narrative?: string;
		verification_state: string;
		corroboration_count: number;
	}

	let published = $state(false);
	let loaded = $state(false);
	let incidents = $state<PublicIncident[]>([]);
	let selectedType = $state<IncidentType | 'all'>('all');
	let selectedRegion = $state<string>('all');
	let query = $state('');

	const regions = $derived(
		[...new Set(incidents.map((i) => regionState(i.region_bucket)))].sort()
	);

	const filtered = $derived(
		incidents.filter((i) => {
			if (selectedType !== 'all' && i.type !== selectedType) return false;
			if (selectedRegion !== 'all' && regionState(i.region_bucket) !== selectedRegion) return false;
			if (query.trim()) {
				const q = query.trim().toLowerCase();
				const hay = `${i.narrative ?? ''} ${regionLabel(i.region_bucket)} ${
					isIncidentType(i.type) ? incidentTypeLabel(i.type) : i.type
				}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		})
	);

	function typeLabel(t: string): string {
		return isIncidentType(t) ? incidentTypeLabel(t) : t;
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/incidents/index');
			if (res.ok) {
				const data = (await res.json()) as { published?: boolean; incidents?: PublicIncident[] };
				published = data.published === true;
				incidents = data.incidents ?? [];
			}
		} catch {
			/* offline / not deployed: shows the not-open state */
		}
		loaded = true;
	});
</script>

<svelte:head>
	<title>{m.incidents_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.incidents_title()}</h1>

{#if loaded && !published}
	<p class="safety-copy">{m.incidents_not_open()}</p>
{:else}
	<p class="safety-copy">{m.incidents_intro()}</p>

	<!-- Map is deferred to M3; an honest placeholder for now. -->
	<div class="map-placeholder" role="img" aria-label={m.incidents_map_soon()}>
		<span class="muted">{m.incidents_map_soon()}</span>
	</div>

	<label class="lbl" for="region">{m.incidents_filter_region()}</label>
	<select id="region" class="field" bind:value={selectedRegion}>
		<option value="all">{m.incidents_filter_all_regions()}</option>
		{#each regions as r (r)}
			<option value={r}>{regionLabel(r)}</option>
		{/each}
	</select>

	<div class="chips" role="group" aria-label={m.incidents_filter_type()}>
		<button type="button" class="chip" aria-pressed={selectedType === 'all'} onclick={() => (selectedType = 'all')}>
			{m.incidents_all_types()}
		</button>
		{#each INCIDENT_TYPES as t (t)}
			<button type="button" class="chip" aria-pressed={selectedType === t} onclick={() => (selectedType = t)}>
				{incidentTypeLabel(t)}
			</button>
		{/each}
	</div>

	<input class="field" type="search" bind:value={query} placeholder={m.incidents_search_ph()} aria-label={m.incidents_search_ph()} />

	{#if loaded && filtered.length === 0}
		<p class="muted">{m.incidents_none()}</p>
	{:else}
		<div class="stack">
			{#each filtered as i (i.id)}
				<article class="card inc-card">
					<div class="inc-head">
						<span class="inc-type">{typeLabel(i.type)}</span>
						<VerificationChip kind={incidentLabelKind(i.verification_state)} />
					</div>
					<p class="inc-meta muted">
						{regionLabel(i.region_bucket)}{i.occurred_date ? ` · ${i.occurred_date}` : ''}{i.actor_unit
							? ` · ${i.actor_unit}`
							: ''}
					</p>
					{#if i.narrative}<p class="inc-narr">{i.narrative}</p>{/if}
					{#if i.corroboration_count > 0}
						<p class="muted inc-corr">{m.incidents_corroborated({ n: i.corroboration_count })}</p>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.map-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 120px;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
		background: var(--surface-2);
	}
	.lbl {
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
	}
	.field {
		width: 100%;
		min-height: 48px;
		padding: var(--sp-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-base);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.chip {
		min-height: 44px;
		padding: var(--sp-2) var(--sp-3);
		border: 1px solid var(--border);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.chip[aria-pressed='true'] {
		background: var(--accent);
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.inc-card {
		flex-direction: column;
		align-items: stretch;
		gap: var(--sp-2);
	}
	.inc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.inc-type {
		font-weight: var(--fw-semi);
		font-size: var(--text-lg);
	}
	.inc-meta {
		font-size: var(--text-sm);
	}
</style>
