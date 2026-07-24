<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { exportPack, verifyShareBundle } from '$lib/pack-share';

	const PACK_PATH = '/packs/crisis-cards-v1.harborage-pack';

	let importMessage = $state('');
	let importKind = $state<'verified' | 'unverified' | 'not-a-pack' | ''>('');

	async function onExport() {
		const bundle = await exportPack(PACK_PATH);
		if (!bundle) return;
		const url = URL.createObjectURL(new Blob([bundle], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'harborage-safety-content.json';
		a.click();
		URL.revokeObjectURL(url);
	}

	async function onImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const verdict = verifyShareBundle(await file.text());
		importKind = verdict.kind;
		importMessage =
			verdict.kind === 'verified'
				? m.share_import_ok()
				: verdict.kind === 'unverified'
					? m.share_import_unverified()
					: m.share_import_bad();
		input.value = '';
	}
</script>

<svelte:head>
	<title>{m.share_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="safety-copy">{m.share_title()}</h1>
<p class="safety-copy">{m.share_intro()}</p>

<div class="stack">
	<button class="btn" onclick={onExport}>{m.share_export()}</button>

	<label class="btn file">
		{m.share_import()}
		<input type="file" accept="application/json,.json" onchange={onImport} />
	</label>

	{#if importMessage}
		<p class="result safety-copy" class:alert={importKind !== 'verified'} role="status">
			{importMessage}
		</p>
	{/if}
</div>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: var(--text-base);
		cursor: pointer;
	}
	.file input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.result {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: var(--sp-2) var(--sp-3);
	}
	.result.alert {
		border: 2px solid var(--hazard);
		color: var(--hazard);
	}
</style>
