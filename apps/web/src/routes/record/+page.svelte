<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import { records, type LocalRecord } from '$lib/records';
	import { incidentTypeLabel } from '$lib/incident-types';
	import { getIntakeStatus, sendRecord } from '$lib/uploads';
	import { IdbOutboxStore } from '@harborage/outbox';

	let items = $state<LocalRecord[]>([]);
	let loaded = $state(false);
	let thumbs = $state(new Map<string, string>());
	// Off-device send is hidden unless record_intake is on (defaults off offline).
	let canSend = $state(false);
	let sendingId = $state<string | null>(null);
	let sendMsg = $state('');

	const kindIcon: Record<string, string> = { photo: 'camera', note: 'book', audio: 'phone' };

	async function handleSend(r: LocalRecord) {
		sendingId = r.id;
		sendMsg = '';
		const fresh = await records.get(r.id);
		if (!fresh) {
			sendingId = null;
			return;
		}
		const outcome = await sendRecord(fresh, new IdbOutboxStore(), fetch);
		if (outcome === 'sent') {
			fresh.sent = true;
			await records.put(fresh);
			await reload();
		} else if (outcome === 'not_open') {
			sendMsg = m.send_not_open();
		} else {
			sendMsg = m.send_failed();
		}
		sendingId = null;
	}

	function makeThumbs(list: LocalRecord[]) {
		for (const url of thumbs.values()) URL.revokeObjectURL(url);
		thumbs = new Map();
		for (const r of list) {
			if (r.derivative) thumbs.set(r.id, URL.createObjectURL(r.derivative.blob));
		}
	}

	async function reload() {
		const list = await records.list();
		makeThumbs(list);
		items = list;
		loaded = true;
	}

	async function remove(id: string) {
		await records.delete(id);
		await reload();
	}

	function dateLabel(r: LocalRecord): string {
		return new Date(r.createdAt).toLocaleDateString();
	}

	onMount(async () => {
		await reload();
		canSend = (await getIntakeStatus()).record_intake;
	});
	onDestroy(() => {
		for (const url of thumbs.values()) URL.revokeObjectURL(url);
	});
</script>

<svelte:head>
	<title>{m.nav_record()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_record()}</h1>
<p class="safety-copy">{m.record_keep()}</p>

<a class="hero hero-primary" href={localizeHref('/record/new')}>
	<span class="hero-title"><Icon name="camera" size={28} />{m.record_new()}</span>
	<span class="hero-sub">{m.record_new_sub()}</span>
</a>

<h2>{m.record_mine()}</h2>
{#if loaded && items.length === 0}
	<p class="muted">{m.record_none()}</p>
{:else}
	<div class="list">
		{#each items as r (r.id)}
			<div class="list-row rec-row">
				{#if thumbs.get(r.id)}
					<img class="rec-thumb" src={thumbs.get(r.id)} alt="" />
				{:else}
					<Icon name={kindIcon[r.kind] ?? 'book'} />
				{/if}
				<span class="row-label">
					<span class="rec-title">{r.type ? incidentTypeLabel(r.type) : m.record_untitled()}</span>
					<span class="card-sub"
						>{dateLabel(r)}{r.redactionConfirmed ? '' : ` · ${m.record_private_only()}`}{r.sent
							? ` · ${m.record_sent()}`
							: ''}</span
					>
				</span>
				{#if canSend && !r.sent}
					<button
						type="button"
						class="rec-send"
						disabled={sendingId === r.id}
						onclick={() => handleSend(r)}>{sendingId === r.id ? m.sending() : m.send_archive()}</button
					>
				{/if}
				<button type="button" class="rec-remove" onclick={() => remove(r.id)}
					>{m.record_remove()}</button
				>
			</div>
		{/each}
	</div>
	{#if sendMsg}
		<p class="muted" role="status">{sendMsg}</p>
	{/if}
{/if}

<p class="muted">{m.record_location_note()}</p>

<style>
	.rec-row {
		gap: var(--sp-3);
	}
	.rec-thumb {
		width: 44px;
		height: 44px;
		object-fit: cover;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
	}
	.rec-title {
		display: block;
		font-weight: var(--fw-semi);
	}
	.rec-remove,
	.rec-send {
		min-height: 48px;
		padding: var(--sp-2) var(--sp-3);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.rec-send {
		border-color: var(--accent);
		color: var(--accent);
	}
	.rec-send:disabled {
		opacity: 0.6;
	}
</style>
