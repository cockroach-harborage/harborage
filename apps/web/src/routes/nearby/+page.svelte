<script lang="ts">
	/**
	 * The area board. NO MAP, NO PIN, NO "I AM HERE".
	 *
	 * Everything here is zone-level: a zone is a name on a signed list, and this page
	 * never learns or asks for a coordinate. There is no self-location primitive on
	 * this platform to build one from.
	 *
	 * THE CACHED ROWS STAY ON SCREEN. When a fetch fails, or the board says it is
	 * rebuilding after an eviction, this page keeps showing what it last knew under a
	 * plain "may be out of date" line. Dark with a badge is still dark, and an empty
	 * list reads as "no hazards here" — a claim nobody made.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import VerificationChip from '$lib/components/VerificationChip.svelte';
	import { regionLabel, regionState } from '$lib/region';
	import { bandLabel, boardLabelKind, signalLabel } from '$lib/liveboard-labels';
	import { fetchBoard, READ_WAIT_MS } from '$lib/liveboard-client';
	import { present, type BoardSnapshot } from '$lib/liveboard-cache';
	import { EMPTY_ZONE_STATE, verifyFetchedZones, type ZoneListState } from '$lib/liveboard-zones';
	import type { Band, SignalType } from '@harborage/worker-lib/liveboard';

	let zoneState = $state<ZoneListState>(EMPTY_ZONE_STATE);
	let selectedRegion = $state<string>('all');
	let zoneId = $state<string>('');
	let snapshot = $state<BoardSnapshot | null>(null);
	let stale = $state(false);
	let blank = $state(true);
	let loaded = $state(false);

	const regions = $derived(
		[...new Set(zoneState.zones.map((z) => regionState(z.region_bucket)))].sort()
	);
	const zonesHere = $derived(
		selectedRegion === 'all'
			? zoneState.zones
			: zoneState.zones.filter((z) => regionState(z.region_bucket) === selectedRegion)
	);

	async function loadZones() {
		try {
			const res = await fetch('/api/live/zones');
			zoneState = await verifyFetchedZones(await res.json(), zoneState.epoch);
		} catch {
			zoneState = { zones: [], epoch: zoneState.epoch, reason: 'unreachable' };
		}
		loaded = true;
	}

	async function refresh(id: string, since: number | null) {
		const outcome = await fetchBoard(id, {
			fetch,
			...(since === null ? {} : { sinceTick: since }),
			waitMs: READ_WAIT_MS
		});
		// Re-read the current zone: a long poll can outlive the choice that started it.
		if (id !== zoneId) return;
		const p = present(snapshot, outcome, id, Date.now());
		snapshot = p.snapshot;
		stale = p.stale;
		blank = p.blank;
	}

	onMount(() => {
		void loadZones();
	});

	/**
	 * A zone change discards the previous board rather than carrying it over.
	 * reconcile() refuses a cross-zone cache anyway; this keeps the screen honest in
	 * the interval before the first response arrives.
	 */
	$effect(() => {
		const id = zoneId;
		if (!id) return;
		snapshot = null;
		stale = false;
		blank = true;
		void refresh(id, null);
	});
</script>

<svelte:head>
	<title>{m.board_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.board_title()}</h1>

<p>{m.board_delay()}</p>
<p class="muted">{m.board_not_watching()}</p>
<p class="muted">{m.board_not_watching_2()}</p>

{#if loaded && zoneState.reason === 'none-listed'}
	<p>{m.board_no_zones()}</p>
{:else if loaded && zoneState.reason === 'unverified'}
	<p>{m.board_unverified()}</p>
{:else if loaded && zoneState.reason === 'rolled-back'}
	<p>{m.board_rolled_back()}</p>
{:else if loaded && zoneState.reason === 'unreachable'}
	<p>{m.nearby_empty()}</p>
{/if}

{#if zoneState.zones.length > 0}
	{#if regions.length > 1}
		<label class="lbl" for="board-region">{m.report_area()}</label>
		<select id="board-region" class="field" bind:value={selectedRegion}>
			<option value="all">{m.incidents_filter_all_regions()}</option>
			{#each regions as r (r)}
				<option value={r}>{r}</option>
			{/each}
		</select>
	{/if}

	<label class="lbl" for="board-zone">{m.report_area()}</label>
	<select id="board-zone" class="field" bind:value={zoneId}>
		<option value="">{m.incidents_filter_all_regions()}</option>
		{#each zonesHere as z (z.zone_id)}
			<option value={z.zone_id}>{regionLabel(z.region_bucket)}</option>
		{/each}
	</select>
{/if}

{#if zoneId}
	{#if stale}
		<p class="stalebadge">{m.board_stale()}</p>
	{/if}

	{#if blank || !snapshot}
		<p>{m.board_blank()}</p>
	{:else}
		{#if snapshot.band}
			<p class="band">
				<span class="bandlbl">{m.board_crowd()}</span>
				<span class="bandword">{bandLabel[snapshot.band as Band]?.() ?? snapshot.band}</span>
			</p>
		{/if}

		{#if snapshot.signals.length === 0}
			<p>{m.board_blank()}</p>
		{:else}
			<ul class="rows">
				{#each snapshot.signals as row (row.signal)}
					<li class="row">
						<span class="what">{signalLabel[row.signal as SignalType]?.() ?? row.signal}</span>
						<VerificationChip kind={boardLabelKind(row)} />
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
{/if}

<p><a class="btn" href="/nearby/report">{m.board_send()}</a></p>

<style>
	.lbl {
		display: block;
		margin-top: var(--sp-3);
		font-weight: 600;
	}
	.stalebadge {
		border-left: 4px solid var(--warn, #8a6d00);
		padding-left: var(--sp-2);
		font-weight: 600;
	}
	.band {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: baseline;
	}
	.bandlbl {
		color: var(--muted);
	}
	.bandword {
		font-weight: 600;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: var(--sp-3) 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: center;
		min-height: 48px;
		padding: var(--sp-2) 0;
		border-bottom: 1px solid var(--line);
	}
	.what {
		font-size: 1.0625rem;
		font-weight: 600;
	}
</style>
