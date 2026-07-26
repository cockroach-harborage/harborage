<script lang="ts">
	/**
	 * The institutional accountability dashboard (PRD §4.10).
	 *
	 * THE INSTITUTION IS THE PRIMARY SURFACE, not a fallback. Patterns by station,
	 * unit, rank band and shift are what this page is for; an individual name is the
	 * exception, and it appears only when the reader's own device has verified a
	 * reviewer quorum over the exact fields being rendered.
	 *
	 * SO THE PAGE LOOKS THE SAME WHETHER OR NOT VERIFICATION SUCCEEDS. There is no
	 * gap, no error, no "name hidden" placeholder that implies something is being
	 * kept from the reader — just a line saying no name is shown. Today no reviewer
	 * key is pinned, so that is every record.
	 *
	 * "Documented allegation under lawful process", never "guilty". The copy says so
	 * at the top and the word does not appear anywhere on this page.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { regionLabel, regionState } from '$lib/region';
	import {
		institutionalView,
		verifyNaming,
		type NamingRecord,
		type SignedRecord
	} from '$lib/accountability-verify';

	interface ServedRecord extends NamingRecord {
		record_hash: string;
		quorum_bundle: string;
	}

	/** A record plus what the DEVICE decided about its name. */
	interface Shown {
		record: NamingRecord;
		name: string | null;
		badge: string | null;
		/** True when a name exists but this device would not vouch for it. */
		unchecked: boolean;
	}

	let published = $state(false);
	let stale = $state(false);
	let loaded = $state(false);
	let shown = $state<Shown[]>([]);
	let selectedRegion = $state<string>('all');

	const regions = $derived(
		[...new Set(shown.map((s) => regionState(s.record.region_bucket)))].sort()
	);
	const visible = $derived(
		selectedRegion === 'all'
			? shown
			: shown.filter((s) => regionState(s.record.region_bucket) === selectedRegion)
	);

	/** Cases per station. Computed here, never asked of the database. */
	const byStation = $derived(
		[
			...visible.reduce((acc, s) => {
				const k = s.record.station_code;
				acc.set(k, (acc.get(k) ?? 0) + 1);
				return acc;
			}, new Map<string, number>())
		].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
	);

	function splitServed(served: ServedRecord): SignedRecord {
		const { record_hash, quorum_bundle, ...record } = served;
		let signatures: SignedRecord['signatures'] = [];
		try {
			const parsed: unknown = JSON.parse(quorum_bundle);
			if (Array.isArray(parsed)) signatures = parsed;
		} catch {
			// A malformed bundle is no bundle. verifyNaming will withhold the name,
			// which is the same outcome as a bundle that fails to verify.
		}
		return { record, record_hash, signatures };
	}

	async function load() {
		try {
			const res = await fetch('/api/accountability/records');
			const body = (await res.json()) as {
				published?: boolean;
				stale?: boolean;
				records?: ServedRecord[];
			};
			published = body.published === true;
			stale = body.stale === true;
			const served = Array.isArray(body.records) ? body.records : [];
			shown = await Promise.all(
				served.map(async (s) => {
					const signed = splitServed(s);
					const verdict = await verifyNaming(signed);
					const hasName =
						signed.record.official_name !== null || signed.record.official_badge !== null;
					return verdict.named
						? { record: signed.record, name: verdict.name, badge: verdict.badge, unchecked: false }
						: { record: signed.record, name: null, badge: null, unchecked: hasName };
				})
			);
		} catch {
			stale = true;
		}
		loaded = true;
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:head>
	<title>{m.acct_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.acct_title()}</h1>

<p>{m.acct_what()}</p>
<p>{m.acct_not_guilty()}</p>
<p class="muted">{m.acct_official_only()}</p>
<p class="muted">{m.acct_no_private()}</p>

{#if loaded && !published}
	<p>{m.acct_off()}</p>
{:else if loaded}
	{#if stale}
		<p class="stalebadge">{m.acct_stale()}</p>
	{/if}

	{#if shown.length === 0}
		<p>{m.acct_empty()}</p>
	{:else}
		{#if regions.length > 1}
			<label class="lbl" for="acct-region">{m.acct_area()}</label>
			<select id="acct-region" class="field" bind:value={selectedRegion}>
				<option value="all">{m.incidents_filter_all_regions()}</option>
				{#each regions as r (r)}
					<option value={r}>{r}</option>
				{/each}
			</select>
		{/if}

		<h2>{m.acct_pattern()}</h2>
		<ul class="rows">
			{#each byStation as [station, count] (station)}
				<li class="row">
					<span class="what">{station}</span>
					<span class="muted">{m.acct_count()}: {count}</span>
				</li>
			{/each}
		</ul>

		<ul class="rows">
			{#each visible as s (s.record.id)}
				{@const view = institutionalView(s.record)}
				<li class="card">
					<dl class="pairs">
						<dt>{m.acct_station()}</dt>
						<dd>{view.station_code}</dd>
						{#if view.unit_code}
							<dt>{m.acct_unit()}</dt>
							<dd>{view.unit_code}</dd>
						{/if}
						{#if view.rank_band}
							<dt>{m.acct_rank()}</dt>
							<dd>{view.rank_band}</dd>
						{/if}
						{#if view.shift_bucket}
							<dt>{m.acct_shift()}</dt>
							<dd>{view.shift_bucket}</dd>
						{/if}
						<dt>{m.acct_area()}</dt>
						<dd>{regionLabel(view.region_bucket)}</dd>
					</dl>

					{#if s.name || s.badge}
						<p class="named">{s.name ?? ''} {s.badge ?? ''}</p>
					{:else if s.unchecked}
						<p class="muted">{m.acct_name_unchecked()}</p>
					{:else}
						<p class="muted">{m.acct_name_withheld()}</p>
					{/if}

					<p class="muted">{m.acct_reply()}: {m.acct_reply_how()}</p>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<p><a href="/settings">{m.acct_remove()}</a></p>

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
	.rows {
		list-style: none;
		padding: 0;
		margin: var(--sp-3) 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		justify-content: space-between;
		min-height: 48px;
		align-items: center;
		padding: var(--sp-2) 0;
		border-bottom: 1px solid var(--line);
	}
	.card {
		padding: var(--sp-3) 0;
		border-bottom: 1px solid var(--line);
	}
	.pairs {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-1) var(--sp-3);
		margin: 0 0 var(--sp-2);
	}
	.pairs dt {
		color: var(--muted);
	}
	.pairs dd {
		margin: 0;
	}
	.what {
		font-weight: 600;
	}
	.named {
		font-weight: 700;
	}
</style>
