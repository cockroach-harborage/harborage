<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { getState } from '$lib/identity';
	import { wipeDevice } from '$lib/wipe';

	/**
	 * The erase (ARCHITECTURE §19:1302). Two taps, never one: the confirm step
	 * lists exactly what goes, including the sentence about a sealed original
	 * that never reached the vault.
	 *
	 * Removing the account is a separate, unchecked box rather than a second
	 * button. Two destructive buttons under stress is a mis-tap that permanently
	 * destroys an account the user could have kept, and backup words are erased
	 * by default after confirmation, so that loss is unrecoverable by design.
	 */
	let view = $state<'info' | 'confirm' | 'busy'>('info');
	let alsoAccount = $state(false);
	let wordsOnDevice = $state(false);
	let hasAccount = $state(false);

	async function openConfirm() {
		try {
			const s = await getState();
			hasAccount = s.exists;
			wordsOnDevice = s.backup === 'kept';
		} catch {
			// No storage: offer the narrow erase rather than blocking it.
			hasAccount = false;
			wordsOnDevice = false;
		}
		view = 'confirm';
	}

	async function erase() {
		view = 'busy';
		await wipeDevice({ identity: alsoAccount && hasAccount });
		// Same destination as the quick exit, so Back does not return here and a
		// fresh navigation cannot be served by the worker we just unregistered.
		location.replace(localizeHref('/directory'));
	}
</script>

<svelte:head>
	<title>{m.set_safe_mode()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_safe_mode()}</h1>
<div class="stack safety-copy">
	<p>{m.set_safe_1()}</p>
	<p>{m.set_safe_2()}</p>
	<p>{m.set_safe_3()}</p>
</div>

<h2>{m.wipe_title()}</h2>
{#if view === 'info'}
	<div class="stack safety-copy">
		<p>{m.wipe_intro()}</p>
		<p>{m.wipe_limit_1()}</p>
		<p>{m.wipe_limit_2()}</p>
	</div>
	<button type="button" class="danger" data-testid="wipe-start" onclick={openConfirm}
		>{m.wipe_start()}</button
	>
{:else if view === 'confirm'}
	<h3>{m.wipe_confirm_title()}</h3>
	<div class="stack safety-copy">
		<p>{m.wipe_1()}</p>
		<p>{m.wipe_2()}</p>
		<p>{m.wipe_3()}</p>
		<p>{m.wipe_4()}</p>
		<p>{m.wipe_5()}</p>
	</div>
	{#if hasAccount}
		<label class="opt">
			<input type="checkbox" data-testid="wipe-account" bind:checked={alsoAccount} />
			<span>
				{m.wipe_also_account()}
				<span class="card-sub">{m.wipe_also_account_hint()}</span>
				{#if alsoAccount && wordsOnDevice}
					<span class="card-sub">{m.wipe_words_here()}</span>
				{/if}
			</span>
		</label>
	{/if}
	<div class="row">
		<button type="button" class="danger" data-testid="wipe-go" onclick={erase}>{m.wipe_go()}</button>
		<button type="button" onclick={() => (view = 'info')}>{m.wipe_cancel()}</button>
	</div>
{:else}
	<p role="status">{m.wipe_busy()}</p>
{/if}

<style>
	button {
		min-height: 48px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.danger {
		border-color: var(--hazard);
		color: var(--hazard);
	}
	.row {
		display: flex;
		gap: var(--sp-3);
		flex-wrap: wrap;
		margin-top: var(--sp-3);
	}
	.opt {
		display: flex;
		gap: var(--sp-3);
		align-items: flex-start;
		min-height: 48px;
		padding: var(--sp-2) 0;
	}
	.opt input {
		width: 24px;
		height: 24px;
		margin-top: var(--sp-1);
		flex: none;
	}
	.opt .card-sub {
		display: block;
	}
</style>
