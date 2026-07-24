<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import RedactionCanvas from '$lib/components/RedactionCanvas.svelte';
	import { INCIDENT_TYPES, incidentTypeLabel, type IncidentType } from '$lib/incident-types';
	import { processImage, sealMedia, type Box } from '$lib/pipeline/pipeline-client';
	import { records, newId, type Derivative, type SealedOriginal, type RecordKind } from '$lib/records';

	type Step = 'choose' | 'photo' | 'audio' | 'import' | 'describe' | 'saved';
	let step = $state<Step>('choose');
	let kind = $state<RecordKind>('note');
	let busy = $state(false);
	let error = $state('');

	// photo
	let imageBlob = $state<Blob | null>(null);
	let boxes = $state<Box[]>([]);
	// audio
	let audioBlob = $state<Blob | null>(null);
	let recording = $state(false);
	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = [];
	// import
	let sourceLink = $state('');
	// processed media — plain, non-reactive: Svelte $state proxies are not
	// structured-cloneable, so they cannot be posted to a worker or put in
	// IndexedDB. hasCovered drives the template instead.
	let original: SealedOriginal | undefined;
	let derivative: Derivative | undefined;
	let hasCovered = $state(false);
	let redactionConfirmed = $state(false);
	// describe
	let chosenType = $state<IncidentType | ''>('');
	let note = $state('');
	let area = $state('');
	let occurredDate = $state('');

	function reset() {
		imageBlob = null;
		boxes = [];
		audioBlob = null;
		original = undefined;
		derivative = undefined;
		hasCovered = false;
		redactionConfirmed = false;
		sourceLink = '';
		chosenType = '';
		note = '';
		area = '';
		occurredDate = '';
		error = '';
	}

	function onPickPhoto(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) imageBlob = file;
	}

	async function confirmRedaction(hide: boolean) {
		if (!imageBlob) return;
		busy = true;
		error = '';
		try {
			const bytes = await imageBlob.arrayBuffer();
			const out = await processImage(bytes, imageBlob.type || 'image/jpeg', boxes, hide);
			original = out.original;
			derivative = out.derivative ?? undefined;
			hasCovered = !!derivative;
			redactionConfirmed = hide;
			step = 'describe';
		} catch {
			error = m.err_generic();
		} finally {
			busy = false;
		}
	}

	async function startAudio() {
		error = '';
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaRecorder = new MediaRecorder(stream);
			audioChunks = [];
			mediaRecorder.ondataavailable = (ev) => audioChunks.push(ev.data);
			mediaRecorder.onstop = () => {
				audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
				stream.getTracks().forEach((t) => t.stop());
			};
			mediaRecorder.start();
			recording = true;
		} catch {
			error = m.err_mic();
		}
	}
	function stopAudio() {
		mediaRecorder?.stop();
		recording = false;
	}
	async function continueAudio() {
		if (!audioBlob) return;
		busy = true;
		error = '';
		try {
			original = await sealMedia(await audioBlob.arrayBuffer(), audioBlob.type);
			redactionConfirmed = false;
			step = 'describe';
		} catch {
			error = m.err_generic();
		} finally {
			busy = false;
		}
	}

	function continueImport() {
		// Record the link on-device only. Server-side fetch of the media is M3.
		redactionConfirmed = false;
		step = 'describe';
	}

	async function save() {
		busy = true;
		error = '';
		try {
			await records.put({
				id: newId(),
				kind,
				type: chosenType || undefined,
				note: note.trim() || undefined,
				area: area.trim() || undefined,
				occurredDate: occurredDate || undefined,
				sourceLink: sourceLink.trim() || undefined,
				createdAt: Date.now(),
				redactionConfirmed,
				derivative,
				original
			});
			step = 'saved';
		} catch {
			error = m.err_generic();
		} finally {
			busy = false;
		}
	}

	function choose(k: RecordKind, next: Step) {
		reset();
		kind = k;
		step = next;
	}
</script>

<svelte:head>
	<title>{m.record_new()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.record_new()}</h1>
<p class="safety-copy">{m.record_stays()}</p>

{#if error}
	<p class="err" role="alert">{error}</p>
{/if}

{#if step === 'choose'}
	<div class="list">
		<button type="button" class="list-row" onclick={() => choose('photo', 'photo')}>
			<Icon name="camera" />
			<span class="row-label">{m.record_choose_photo()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</button>
		<button type="button" class="list-row" onclick={() => choose('note', 'describe')}>
			<Icon name="book" />
			<span class="row-label">{m.record_choose_note()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</button>
		<button type="button" class="list-row" onclick={() => choose('audio', 'audio')}>
			<Icon name="phone" />
			<span class="row-label">{m.record_choose_audio()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</button>
		<button type="button" class="list-row" onclick={() => choose('note', 'import')}>
			<Icon name="globe" />
			<span class="row-label">{m.record_choose_import()}</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</button>
	</div>
	<p class="muted">{m.record_video_note()}</p>
{:else if step === 'photo'}
	<h2>{m.redact_title()}</h2>
	{#if !imageBlob}
		<p class="safety-copy">{m.record_pick_photo_intro()}</p>
		<label class="hero hero-secondary picker">
			<span class="hero-title"><Icon name="camera" size={28} />{m.record_pick_photo()}</span>
			<input type="file" accept="image/*" capture="environment" onchange={onPickPhoto} />
		</label>
	{:else}
		<p class="safety-copy">{m.redact_intro()}</p>
		<RedactionCanvas {imageBlob} bind:boxes />
		<p class="muted">{m.redact_confirm_q()}</p>
		<div class="stack">
			<button type="button" class="btn-primary" disabled={busy} onclick={() => confirmRedaction(true)}>
				{busy ? m.processing() : m.redact_hide_continue()}
			</button>
			<button type="button" class="btn-outline" disabled={busy} onclick={() => confirmRedaction(false)}>
				{m.redact_keep_private()}
			</button>
			<p class="muted">{m.redact_private_note()}</p>
		</div>
	{/if}
{:else if step === 'audio'}
	<h2>{m.record_choose_audio()}</h2>
	<p class="safety-copy">{m.audio_no_voice()}</p>
	<div class="stack">
		{#if !recording && !audioBlob}
			<button type="button" class="btn-primary" onclick={startAudio}>{m.audio_start()}</button>
		{:else if recording}
			<p role="status">{m.audio_recording()}</p>
			<button type="button" class="btn-primary" onclick={stopAudio}>{m.audio_stop()}</button>
		{:else}
			<p role="status">{m.audio_ready()}</p>
			<button type="button" class="btn-primary" disabled={busy} onclick={continueAudio}>
				{busy ? m.processing() : m.audio_continue()}
			</button>
			<button type="button" class="btn-outline" onclick={startAudio}>{m.audio_again()}</button>
		{/if}
	</div>
{:else if step === 'import'}
	<h2>{m.import_title()}</h2>
	<p class="safety-copy">{m.import_intro()}</p>
	<input class="field" type="url" bind:value={sourceLink} placeholder={m.import_placeholder()} />
	<button type="button" class="btn-primary" disabled={!sourceLink.trim()} onclick={continueImport}>
		{m.import_continue()}
	</button>
{:else if step === 'describe'}
	<h2>{m.describe_title()}</h2>
	{#if hasCovered}
		<p class="muted">{m.describe_covered_ready()}</p>
	{/if}
	<fieldset class="chips">
		<legend>{m.describe_type()}</legend>
		{#each INCIDENT_TYPES as t (t)}
			<button
				type="button"
				class="chip"
				aria-pressed={chosenType === t}
				onclick={() => (chosenType = chosenType === t ? '' : t)}
			>
				{incidentTypeLabel(t)}
			</button>
		{/each}
	</fieldset>
	<label class="lbl" for="note">{m.describe_note()}</label>
	<textarea id="note" class="field" rows="3" bind:value={note} placeholder={m.describe_note_ph()}
	></textarea>
	<label class="lbl" for="area">{m.describe_area()}</label>
	<input id="area" class="field" bind:value={area} placeholder={m.describe_area_ph()} />
	<label class="lbl" for="date">{m.describe_date()}</label>
	<input id="date" class="field" type="date" bind:value={occurredDate} />
	<p class="muted">{m.describe_location_removed()}</p>
	<button type="button" class="btn-primary" disabled={busy} onclick={save}>
		{busy ? m.processing() : m.describe_save()}
	</button>
{:else if step === 'saved'}
	<h2>{m.saved_title()}</h2>
	<p class="safety-copy">{m.saved_body()}</p>
	<div class="stack">
		<a class="btn-primary" href={localizeHref('/record')}>{m.saved_view()}</a>
		<button
			type="button"
			class="btn-outline"
			onclick={() => {
				reset();
				step = 'choose';
			}}>{m.saved_add()}</button
		>
	</div>
{/if}

{#if step !== 'choose' && step !== 'saved'}
	<button
		type="button"
		class="btn-quiet"
		onclick={() => {
			reset();
			step = 'choose';
		}}>{m.back()}</button
	>
{/if}

<style>
	.picker {
		position: relative;
		cursor: pointer;
	}
	.picker input[type='file'] {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.btn-primary,
	.btn-outline {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 52px;
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--r-md);
		font: inherit;
		font-size: var(--text-base);
		font-weight: var(--fw-semi);
		text-decoration: none;
		cursor: pointer;
		border: 2px solid var(--accent);
	}
	.btn-primary {
		background: var(--accent);
		color: var(--accent-text);
	}
	.btn-outline {
		background: var(--surface);
		color: var(--accent);
	}
	.btn-primary:disabled,
	.btn-outline:disabled {
		opacity: 0.6;
	}
	.btn-quiet {
		align-self: flex-start;
		min-height: 48px;
		padding: var(--sp-2) var(--sp-3);
		border: 0;
		background: none;
		color: var(--text-muted);
		font: inherit;
		cursor: pointer;
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
	textarea.field {
		min-height: 96px;
		resize: vertical;
	}
	.lbl {
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		border: 0;
		padding: 0;
		margin: 0;
	}
	.chips legend {
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
		margin-bottom: var(--sp-2);
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
	.err {
		background: var(--surface);
		border: 1px solid var(--hazard);
		border-radius: var(--r-sm);
		padding: var(--sp-3);
		color: var(--hazard);
	}
</style>
