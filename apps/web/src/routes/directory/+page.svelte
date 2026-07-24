<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import VerificationChip from '$lib/components/VerificationChip.svelte';
	import { DIR_CATEGORIES, dirCategoryLabel, parseLanguages } from '$lib/directory';
	import { directoryLabelKind } from '$lib/verification';
	import { regionLabel, regionState } from '$lib/region';

	interface ResourceEntry {
		id: string;
		category: string;
		name_i18n: string;
		region_bucket: string;
		address_i18n?: string;
		contact_method: string;
		contact_value?: string;
		languages?: string;
		visibility_tier: string;
		verification_state: string;
		is_core_infra: number;
	}

	let loaded = $state(false);
	let entries = $state<ResourceEntry[]>([]);
	let canReport = $state(false);
	let selectedCat = $state<string>('all');
	let selectedRegion = $state<string>('all');
	let selectedLang = $state<string>('all');
	let query = $state('');
	let openReportId = $state<string | null>(null);
	let reportMsg = $state('');

	const regions = $derived([...new Set(entries.map((e) => regionState(e.region_bucket)))].sort());
	const langs = $derived([...new Set(entries.flatMap((e) => parseLanguages(e.languages)))].sort());

	const filtered = $derived(
		entries.filter((e) => {
			if (selectedCat !== 'all' && e.category !== selectedCat) return false;
			if (selectedRegion !== 'all' && regionState(e.region_bucket) !== selectedRegion) return false;
			if (selectedLang !== 'all' && !parseLanguages(e.languages).includes(selectedLang)) return false;
			if (query.trim()) {
				const q = query.trim().toLowerCase();
				const hay = `${e.name_i18n} ${dirCategoryLabel(e.category)} ${regionLabel(e.region_bucket)} ${
					e.address_i18n ?? ''
				}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		})
	);

	async function sendReport(id: string, reason: string) {
		reportMsg = '';
		try {
			const res = await fetch('/api/directory/report', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ entity_id: id, reason_code: reason })
			});
			if (res.status === 403) reportMsg = m.dir_report_not_open();
			else if (res.ok) reportMsg = m.dir_report_thanks();
			else reportMsg = m.dir_report_failed();
		} catch {
			reportMsg = m.dir_report_failed();
		}
		openReportId = null;
	}

	onMount(async () => {
		try {
			const [packRes, statusRes] = await Promise.all([
				fetch('/api/directory/pack'),
				fetch('/api/intake/status')
			]);
			if (packRes.ok) entries = ((await packRes.json()) as { entries?: ResourceEntry[] }).entries ?? [];
			if (statusRes.ok)
				canReport =
					((await statusRes.json()) as { directory_intake?: boolean }).directory_intake === true;
		} catch {
			/* degrade safe: empty directory */
		}
		loaded = true;
	});
</script>

<svelte:head>
	<title>{m.nav_directory()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_directory()}</h1>

{#if loaded && entries.length === 0}
	<p class="muted">{m.directory_empty()}</p>
{:else}
	<p class="safety-copy">{m.directory_intro()}</p>

	<div class="chips" role="group" aria-label={m.incidents_filter_type()}>
		<button type="button" class="chip" aria-pressed={selectedCat === 'all'} onclick={() => (selectedCat = 'all')}>
			{m.dir_all()}
		</button>
		{#each DIR_CATEGORIES as c (c.key)}
			<button
				type="button"
				class="chip"
				aria-pressed={selectedCat === c.key}
				onclick={() => (selectedCat = c.key)}>{c.label()}</button
			>
		{/each}
	</div>

	<div class="filters">
		<select class="field" bind:value={selectedRegion} aria-label={m.incidents_filter_region()}>
			<option value="all">{m.incidents_filter_all_regions()}</option>
			{#each regions as r (r)}
				<option value={r}>{regionLabel(r)}</option>
			{/each}
		</select>
		<select class="field" bind:value={selectedLang} aria-label={m.dir_filter_lang()}>
			<option value="all">{m.dir_all_langs()}</option>
			{#each langs as l (l)}
				<option value={l}>{l}</option>
			{/each}
		</select>
	</div>

	<input
		class="field"
		type="search"
		bind:value={query}
		placeholder={m.dir_search_ph()}
		aria-label={m.dir_search_ph()}
	/>

	{#if reportMsg}<p class="muted" role="status">{reportMsg}</p>{/if}

	{#if loaded && filtered.length === 0}
		<p class="muted">{m.dir_none()}</p>
	{:else}
		<div class="stack">
			{#each filtered as e (e.id)}
				<article class="card dir-card">
					<div class="dir-head">
						<span class="dir-name">{e.name_i18n}</span>
						<VerificationChip kind={directoryLabelKind(e.verification_state)} />
					</div>
					<p class="muted dir-meta">
						{dirCategoryLabel(e.category)} · {regionLabel(e.region_bucket)}
					</p>
					{#if e.visibility_tier === 'PUBLIC_ADDRESS' && e.address_i18n}
						<p class="dir-addr">{e.address_i18n}</p>
					{/if}
					<div class="dir-actions">
						{#if e.contact_method === 'PHONE' && e.contact_value}
							<a class="dir-btn" href="tel:{e.contact_value}">{m.dir_contact_call()}</a>
						{:else if e.contact_method === 'URL' && e.contact_value}
							<a class="dir-btn" href={e.contact_value} rel="noopener">{m.dir_contact_open()}</a>
						{:else if e.contact_method === 'WALK_IN'}
							<span class="muted">{m.dir_contact_walkin()}</span>
						{:else if e.contact_method === 'IN_APP_BROKER'}
							<span class="muted">{m.dir_contact_broker()}</span>
						{/if}
						{#if canReport}
							<button
								type="button"
								class="dir-btn dir-report"
								onclick={() => (openReportId = openReportId === e.id ? null : e.id)}
								>{m.dir_report()}</button
							>
						{/if}
					</div>
					{#if openReportId === e.id}
						<div class="report-panel">
							<p class="lbl">{m.dir_report_reason()}</p>
							<div class="chips">
								<button type="button" class="chip" onclick={() => sendReport(e.id, 'unsafe')}
									>{m.dir_reason_unsafe()}</button
								>
								<button type="button" class="chip" onclick={() => sendReport(e.id, 'closed')}
									>{m.dir_reason_closed()}</button
								>
								<button type="button" class="chip" onclick={() => sendReport(e.id, 'wrong_info')}
									>{m.dir_reason_wrong()}</button
								>
								<button type="button" class="chip" onclick={() => sendReport(e.id, 'other')}
									>{m.dir_reason_other()}</button
								>
							</div>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
{/if}

<style>
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
	.filters {
		display: flex;
		gap: var(--sp-2);
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
	.lbl {
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
	}
	.dir-card {
		flex-direction: column;
		align-items: stretch;
		gap: var(--sp-2);
	}
	.dir-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.dir-name {
		font-weight: var(--fw-semi);
		font-size: var(--text-lg);
	}
	.dir-meta {
		font-size: var(--text-sm);
	}
	.dir-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: center;
	}
	.dir-btn {
		display: inline-flex;
		align-items: center;
		min-height: 48px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--accent);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: none;
		cursor: pointer;
	}
	.dir-report {
		border-color: var(--border);
		color: var(--text-muted);
	}
	.report-panel {
		border-top: 1px solid var(--border);
		padding-top: var(--sp-2);
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
</style>
