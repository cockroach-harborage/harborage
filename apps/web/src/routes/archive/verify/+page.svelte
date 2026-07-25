<script lang="ts">
	/**
	 * Independent inclusion verifier (ARCHITECTURE §7.2, §16).
	 *
	 * Deliberately in apps/web rather than on the api Worker. The verifier's whole
	 * promise is that it trusts nothing we serve, and the api has no service-worker
	 * asset pinning, no signed release, no strict CSP and no Trusted Types, while
	 * this app has all four. Because every route is prerendered, a third party can
	 * save this page and run it offline against a proof obtained anywhere.
	 *
	 * PASTE IS THE PRIMARY INPUT, not a fallback. Fetching the proof from us and
	 * then checking it with our code would be a closed loop that proves nothing.
	 * The page makes no network request at all.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { verifyInclusion, type ProofBundle } from '$lib/archive-verify';

	let input = $state('');
	let outcome = $state<
		{ kind: 'ok'; root: string } | { kind: 'bad'; message: string } | null
	>(null);

	const REASON_TEXT: Record<string, () => string> = {
		record_hash_mismatch: () => m.verify_bad_hash(),
		path_does_not_reach_root: () => m.verify_bad_path(),
		malformed: () => m.verify_malformed()
	};

	async function check() {
		outcome = null;
		let bundle: ProofBundle;
		try {
			bundle = JSON.parse(input) as ProofBundle;
		} catch {
			outcome = { kind: 'bad', message: m.verify_malformed() };
			return;
		}
		const result = await verifyInclusion(bundle);
		outcome = result.ok
			? { kind: 'ok', root: result.root }
			: { kind: 'bad', message: (REASON_TEXT[result.reason] ?? REASON_TEXT.malformed!)() };
	}
</script>

<svelte:head>
	<title>{m.verify_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.verify_title()}</h1>
<div class="stack safety-copy">
	<p>{m.verify_intro()}</p>
	<p>{m.verify_offline_note()}</p>
</div>

<label class="field">
	<span>{m.verify_input_label()}</span>
	<textarea bind:value={input} rows="8" spellcheck="false" data-testid="proof-input"></textarea>
</label>
<button type="button" onclick={check} data-testid="verify-go">{m.verify_go()}</button>

{#if outcome?.kind === 'ok'}
	<p class="result ok" role="status" data-testid="verify-result">{m.verify_ok()}</p>
	<p class="muted code">{m.verify_root()}: {outcome.root}</p>
	<!-- Shown on EVERY success, never conditionally. archive_anchoring is off, so
	     no third party has attested to this root, and a green result without this
	     line would read as external corroboration that does not exist. -->
	<p class="muted" data-testid="verify-anchor-note">{m.verify_not_anchored()}</p>
{:else if outcome?.kind === 'bad'}
	<p class="result bad" role="alert" data-testid="verify-result">{outcome.message}</p>
{/if}

<p class="muted">{m.verify_preservation()}</p>

<style>
	.field {
		display: block;
		margin: var(--sp-4) 0 var(--sp-2);
	}
	.field span {
		display: block;
		margin-bottom: var(--sp-2);
	}
	textarea {
		width: 100%;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm);
		padding: var(--sp-2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
	}
	button {
		min-height: 48px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--accent);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
	.result {
		margin-top: var(--sp-3);
		padding: var(--sp-2) var(--sp-3);
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
	}
	.result.bad {
		border: 2px solid var(--hazard);
		color: var(--hazard);
	}
	.code {
		word-break: break-all;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm);
	}
</style>
