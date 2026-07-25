<script lang="ts">
	/**
	 * Identity and backup (PRD §4.3). Everything here runs on this device: there
	 * is no request, no server state, and nothing to reset. The page exists so
	 * the promise the static copy already made — "write down the backup words
	 * when they appear" — is one a user can actually act on.
	 *
	 * Prerendered like every other route, so all of it starts in onMount.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { canEnableKeepWords, CONFIRM_WORD_COUNT } from '$lib/identity-core';
	import {
		confirmBackup,
		create,
		getState,
		IdentityStorageError,
		readWords,
		restore,
		setKeepWords,
		wipe,
		type IdentityState
	} from '$lib/identity';

	type View = 'loading' | 'none' | 'words' | 'confirm' | 'have' | 'restore' | 'wipe';

	let view = $state<View>('loading');
	let identity = $state<IdentityState | null>(null);
	let busy = $state(false);
	let error = $state('');

	let words = $state<string[]>([]);
	let positions = $state<number[]>([]);
	let answers = $state<string[]>([]);
	let keepWords = $state(false);
	let restoreInput = $state('');
	let revealed = $state(false);

	onMount(refresh);

	async function refresh() {
		error = '';
		try {
			identity = await getState();
			view = identity.exists ? 'have' : 'none';
		} catch (e) {
			error = e instanceof IdentityStorageError ? m.ident_storage_error() : String(e);
			view = 'none';
		}
	}

	/** Wrap every action so a storage failure is shown, never swallowed. */
	async function run(fn: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (e) {
			error = e instanceof IdentityStorageError ? m.ident_storage_error() : String(e);
		} finally {
			busy = false;
		}
	}

	const onCreate = () =>
		run(async () => {
			const made = await create();
			words = made.words;
			positions = made.confirmPositions;
			answers = positions.map(() => '');
			revealed = false;
			view = 'words';
		});

	const onWroteThemDown = () => {
		answers = positions.map(() => '');
		view = 'confirm';
	};

	const onConfirm = () =>
		run(async () => {
			const ok = await confirmBackup(positions, answers, keepWords);
			if (!ok) {
				error = m.ident_confirm_bad();
				return;
			}
			words = [];
			await refresh();
		});

	const onRestore = () =>
		run(async () => {
			await restore(restoreInput, false);
			restoreInput = '';
			await refresh();
		});

	const onToggleKeep = (next: boolean) =>
		run(async () => {
			await setKeepWords(next);
			revealed = false;
			words = [];
			await refresh();
		});

	const onReveal = () =>
		run(async () => {
			const stored = await readWords();
			if (!stored) return;
			words = stored;
			revealed = true;
			view = 'words';
		});

	const onWipe = () =>
		run(async () => {
			await wipe();
			words = [];
			revealed = false;
			await refresh();
		});

	function tierLine(s: IdentityState): string {
		if (s.tier === 'secure-curve') return m.ident_tier_full();
		if (s.tier === 'p256') return m.ident_tier_basic();
		return m.ident_tier_readonly();
	}
</script>

<svelte:head>
	<title>{m.set_identity()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_identity()}</h1>

<div class="stack safety-copy">
	<p>{m.set_identity_1()}</p>
	<p>{m.set_identity_2()}</p>
	<p>{m.set_identity_3()}</p>
	<p>{m.set_identity_4()}</p>
	<p>{m.set_identity_5()}</p>
</div>

{#if error}
	<p class="alert safety-copy" role="alert">{error}</p>
{/if}

{#if view === 'loading'}
	<p class="safety-copy" role="status">{m.ident_busy()}</p>
{:else if view === 'none'}
	<h2>{m.ident_none_title()}</h2>
	<div class="stack safety-copy">
		<p>{m.ident_none_1()}</p>
		<p>{m.ident_none_2()}</p>
		{#if identity && !identity.canSign}
			<p class="alert">{m.ident_tier_readonly()}</p>
			<p class="alert">{m.ident_tier_readonly_hint()}</p>
		{/if}
	</div>
	{#if identity?.canSign}
		<div class="stack">
			<button class="btn primary" onclick={onCreate} disabled={busy}>{m.ident_create()}</button>
			<button class="btn" onclick={() => (view = 'restore')} disabled={busy}>
				{m.ident_restore()}
			</button>
		</div>
	{/if}
{:else if view === 'words'}
	<h2>{m.ident_words_title()}</h2>
	<div class="stack safety-copy">
		<p>{m.ident_words_1()}</p>
		<p>{m.ident_words_2()}</p>
		<p class="alert">{m.ident_words_3()}</p>
	</div>
	<ol class="words" data-testid="backup-words">
		{#each words as word, i (i)}
			<li><span class="num">{i + 1}</span>{word}</li>
		{/each}
	</ol>
	{#if revealed}
		<button
			class="btn"
			onclick={() => {
				revealed = false;
				words = [];
				view = 'have';
			}}
		>
			{m.ident_hide_words()}
		</button>
	{:else}
		<button class="btn primary" onclick={onWroteThemDown} disabled={busy}>
			{m.ident_words_done()}
		</button>
	{/if}
{:else if view === 'confirm'}
	<h2>{m.ident_confirm_title()}</h2>
	<div class="stack">
		{#each positions as position, i (position)}
			<label class="field">
				<span>{m.ident_confirm_ask({ n: position + 1 })}</span>
				<input
					type="text"
					autocapitalize="none"
					autocorrect="off"
					spellcheck="false"
					bind:value={answers[i]}
				/>
			</label>
		{/each}
		<label class="check">
			<input type="checkbox" bind:checked={keepWords} />
			<span>
				{m.ident_keep_label()}
				<small>{m.ident_keep_hint()}</small>
			</span>
		</label>
		<button
			class="btn primary"
			onclick={onConfirm}
			disabled={busy || answers.filter((a: string) => a.trim() !== '').length < CONFIRM_WORD_COUNT}
		>
			{m.ident_confirm_go()}
		</button>
	</div>
{:else if view === 'restore'}
	<h2>{m.ident_restore_title()}</h2>
	<div class="stack">
		<p class="safety-copy">{m.ident_restore_hint()}</p>
		<textarea
			rows="4"
			autocapitalize="none"
			spellcheck="false"
			bind:value={restoreInput}
		></textarea>
		<button class="btn primary" onclick={onRestore} disabled={busy || restoreInput.trim() === ''}>
			{m.ident_restore_go()}
		</button>
		<button
			class="btn"
			onclick={() => {
				view = 'none';
				error = '';
			}}
		>
			{m.ident_cancel()}
		</button>
	</div>
{:else if view === 'wipe'}
	<h2>{m.ident_wipe()}</h2>
	<p class="alert safety-copy">{m.ident_wipe_warn()}</p>
	<div class="stack">
		<button class="btn" onclick={() => (view = 'have')}>{m.ident_cancel()}</button>
		<button class="btn danger" onclick={onWipe} disabled={busy}>{m.ident_wipe_go()}</button>
	</div>
{:else if view === 'have' && identity}
	<h2>{m.ident_have_title()}</h2>
	<div class="stack safety-copy">
		<p class="code" data-testid="fingerprint">
			<span class="label">{m.ident_fingerprint()}</span>{identity.fingerprint}
		</p>
		<p><small>{m.ident_fingerprint_hint()}</small></p>
		<p>{tierLine(identity)}</p>
		{#if identity.backup === 'pending'}
			<p class="alert">{m.ident_backup_pending()}</p>
		{/if}
	</div>
	<div class="stack">
		{#if canEnableKeepWords(identity.backup)}
			<label class="check">
				<input
					type="checkbox"
					checked={identity.backup === 'kept'}
					onchange={(e) => onToggleKeep(e.currentTarget.checked)}
					disabled={busy}
				/>
				<span>
					{m.ident_keep_label()}
					<small>{m.ident_keep_hint()}</small>
				</span>
			</label>
			<button class="btn" onclick={onReveal} disabled={busy}>{m.ident_see_words()}</button>
		{:else}
			<p class="safety-copy"><small>{m.ident_keep_gone()}</small></p>
		{/if}
		<button class="btn danger" onclick={() => (view = 'wipe')} disabled={busy}>
			{m.ident_wipe()}
		</button>
	</div>
{/if}

<style>
	h2 {
		margin-top: 1.5rem;
	}
	.btn {
		display: block;
		width: 100%;
		min-height: 48px;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-align: center;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.btn.danger {
		color: var(--hazard);
		border-color: var(--hazard);
	}
	.btn[disabled] {
		opacity: 0.55;
		cursor: default;
	}
	.words {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}
	.words li {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.num {
		min-width: 1.5rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.field {
		display: block;
	}
	.check {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.5rem 0;
	}
	.check input {
		width: 24px;
		height: 24px;
		margin-top: 0.2rem;
		flex: none;
	}
	.field span {
		display: block;
		margin-bottom: 0.25rem;
	}
	small {
		display: block;
		color: var(--text-muted);
	}
	input[type='text'],
	textarea {
		width: 100%;
		min-height: 48px;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.code {
		font-family: ui-monospace, monospace;
		letter-spacing: 0.05em;
	}
	.code .label {
		display: block;
		font-family: inherit;
		letter-spacing: normal;
		color: var(--text-muted);
	}
	.alert {
		color: var(--hazard);
	}
</style>
