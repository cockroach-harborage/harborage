<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import TurnstileWidget from '$lib/components/TurnstileWidget.svelte';
	import { documents, type LocalDocument } from '$lib/documents';
	import { incidentTypeLabel } from '$lib/incident-types';
	import { getIntakeStatus, sendRecord } from '$lib/uploads';
	import { cancelItem, enqueue, listOutbox, type OutboxRow } from '$lib/outbox-runner';
	import { outbox, tryNow } from '$lib/outbox-view.svelte.ts';
	import type { ProgressView } from '$lib/outbox-core';
	import { IdbOutboxStore } from '@harborage/outbox';

	let items = $state<LocalDocument[]>([]);
	let loaded = $state(false);
	let thumbs = $state(new Map<string, string>());
	/** Queue rows by document id, so each row can show where its send got to. */
	let queued = $state(new Map<string, OutboxRow>());
	let storageWarning = $state('');
	// Off-device send is hidden unless document_intake is on (defaults off offline).
	let canSend = $state(false);
	let sendingId = $state<string | null>(null);
	let sendMsg = $state('');
	/**
	 * Sitekey and token for the personhood check. Sending needs BOTH the flag and
	 * a solved challenge: the api Worker has required a `cf-turnstile-response`
	 * header since M1, so an affordance that ignores it is a button that always
	 * fails.
	 */
	let sitekey = $state<string | null>(null);
	let turnstileToken = $state('');

	const kindIcon: Record<string, string> = { photo: 'camera', note: 'book', audio: 'phone' };

	async function handleSend(r: LocalDocument) {
		sendingId = r.id;
		sendMsg = '';
		const fresh = await documents.get(r.id);
		if (!fresh) {
			sendingId = null;
			return;
		}
		// Ask for durable storage and report the headroom before the upload
		// starts. The verdict warns and never blocks: a phone that may evict the
		// sealed original is exactly the phone whose owner most needs it sent.
		const { storage } = await enqueue(fresh);
		if (storage === 'insufficient') storageWarning = m.outbox_storage_full();
		else if (storage === 'not_persisted' || storage === 'tight')
			storageWarning = m.outbox_storage_warn();
		const outcome = await sendRecord(fresh, new IdbOutboxStore(), fetch, turnstileToken);
		if (outcome === 'sent') {
			fresh.sent = true;
			await documents.put(fresh);
			await reload();
		} else if (outcome === 'not_open') {
			sendMsg = m.send_not_open();
		} else {
			sendMsg = m.send_failed();
		}
		sendingId = null;
	}

	function makeThumbs(list: LocalDocument[]) {
		for (const url of thumbs.values()) URL.revokeObjectURL(url);
		thumbs = new Map();
		for (const r of list) {
			if (r.derivative) thumbs.set(r.id, URL.createObjectURL(r.derivative.blob));
		}
	}

	async function reload() {
		const list = await documents.list();
		makeThumbs(list);
		items = list;
		queued = new Map((await listOutbox()).map((row) => [row.id, row]));
		loaded = true;
	}

	async function remove(id: string) {
		// Cancel the queue row FIRST. Deleting the document alone orphaned it, and
		// the next flush then read the row as a sealed original that had vanished
		// from the phone — the spoliation signal, raised by an ordinary delete.
		await cancelItem(id);
		await documents.delete(id);
		await reload();
	}

	async function stopSending(id: string) {
		// Stops the upload. Deliberately does NOT touch the document: the
		// ciphertext lives on the record, shared with the kept-on-phone copy.
		await cancelItem(id);
		await reload();
	}

	async function retryNow() {
		await tryNow();
		await reload();
	}

	/** Progress copy for one queue row. Params only where the copy takes them. */
	function progressText(p: ProgressView): string {
		switch (p.key) {
			case 'outbox_needs_you':
				return m.outbox_needs_you();
			case 'outbox_step_registered':
				return m.outbox_step_registered();
			case 'outbox_step_derivative':
				return m.outbox_step_derivative();
			case 'outbox_step_vaulting':
				return m.outbox_step_vaulting({ sent: p.sentMb ?? '0', total: p.totalMb ?? '0' });
			case 'outbox_step_vaulted':
				return m.outbox_step_vaulted();
			case 'outbox_retry_soon':
				return m.outbox_retry_soon();
			case 'outbox_stopped_trying':
				return m.outbox_stopped_trying();
		}
	}

	/** Custody of the pristine original, stated on every row that has one. */
	function custodyText(r: LocalDocument): string {
		if (r.originalStatus === 'lost') return m.outbox_lost();
		if (r.originalStatus === 'vaulted') return m.outbox_step_vaulted();
		if (r.original) return m.outbox_on_device_only();
		return '';
	}

	function dateLabel(r: LocalDocument): string {
		return new Date(r.createdAt).toLocaleDateString();
	}

	onMount(async () => {
		await reload();
		const status = await getIntakeStatus();
		sitekey = status.turnstile_sitekey;
		// No sitekey means no challenge can be solved, so the send would be
		// refused. Hide the control rather than offer one that cannot work.
		canSend = status.document_intake && sitekey !== null;
	});
	onDestroy(() => {
		for (const url of thumbs.values()) URL.revokeObjectURL(url);
	});
</script>

<svelte:head>
	<title>{m.nav_document()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.nav_document()}</h1>
<p class="safety-copy">{m.document_keep()}</p>

<a class="hero hero-primary" href={localizeHref('/document/new')}>
	<span class="hero-title"><Icon name="camera" size={28} />{m.document_new()}</span>
	<span class="hero-sub">{m.document_new_sub()}</span>
</a>

<h2>{m.document_mine()}</h2>
{#if loaded && items.length === 0}
	<p class="muted">{m.document_none()}</p>
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
					<span class="rec-title">{r.type ? incidentTypeLabel(r.type) : m.document_untitled()}</span>
					<span class="card-sub"
						>{dateLabel(r)}{r.redactionConfirmed ? '' : ` · ${m.document_private_only()}`}{r.sent
							? ` · ${m.document_sent()}`
							: ''}</span
					>
					{#if queued.get(r.id)}
						<span class="card-sub" data-testid="outbox-progress-{r.id}"
							>{progressText(queued.get(r.id)!.progress)}</span
						>
					{/if}
					{#if custodyText(r)}
						<span class="card-sub" data-testid="custody-{r.id}">{custodyText(r)}</span>
					{/if}
				</span>
				{#if canSend && !r.sent}
					<button
						type="button"
						class="rec-send"
						disabled={sendingId === r.id || turnstileToken === ''}
						onclick={() => handleSend(r)}>{sendingId === r.id ? m.sending() : m.send_archive()}</button
					>
				{/if}
				{#if queued.has(r.id)}
					<button type="button" class="rec-remove" onclick={() => stopSending(r.id)}
						>{m.outbox_stop()}</button
					>
				{/if}
				<button type="button" class="rec-remove" onclick={() => remove(r.id)}
					>{m.document_remove()}</button
				>
			</div>
		{/each}
	</div>
	{#if queued.size > 0}
		<div class="check">
			<p class="muted">{m.outbox_stop_note()}</p>
			<button
				type="button"
				class="rec-send"
				data-testid="outbox-try-now"
				disabled={outbox.busy}
				onclick={retryNow}>{m.outbox_try_now()}</button
			>
		</div>
	{/if}
	{#if storageWarning}
		<p class="muted" role="status" data-testid="storage-warning">{storageWarning}</p>
	{/if}
	<!-- One widget for the whole list, not one per row: a single challenge is
	     solved once and its token spent on the next send. Rendered only when a
	     sitekey exists, and the send stays disabled until a token arrives. -->
	{#if canSend && sitekey}
		<div class="check">
			<p class="muted">{m.turnstile_check()}</p>
			<TurnstileWidget {sitekey} bind:token={turnstileToken} />
			{#if turnstileToken === ''}
				<p class="muted">{m.turnstile_wait()}</p>
			{/if}
		</div>
	{/if}
	{#if sendMsg}
		<p class="muted" role="status">{sendMsg}</p>
	{/if}
{/if}

<p class="muted">{m.document_location_note()}</p>

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
