<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RenderedDerivative } from '$lib/pipeline/pipeline-client';

	/**
	 * The before/after confirm, run on THE BYTES THAT SHIP (ARCHITECTURE §19:1216).
	 *
	 * "The pixels the user approves are the pixels that ship. We do not confirm a
	 * display working copy and then re-apply the box geometry through a second
	 * render path — coordinate rounding there can shift a box a few pixels and
	 * under-cover a face nobody reviewed."
	 *
	 * So the "after" view is an object URL over the encoded derivative blob
	 * itself, decoded by the browser exactly as any viewer would decode it. The
	 * worker has already re-decoded those same bytes and asserted every confirmed
	 * region is solid fill; this is the human half of the same guarantee.
	 */
	let {
		original,
		rendered,
		busy = false,
		onconfirm,
		onback,
		onprivate
	}: {
		original: Blob;
		rendered: RenderedDerivative;
		busy?: boolean;
		onconfirm: () => void;
		onback: () => void;
		onprivate: () => void;
	} = $props();

	let showAfter = $state(true);

	// Object URLs are created in an $effect so they are revoked when the blobs
	// change or the component goes away. A leaked URL keeps the whole capture
	// alive in memory on a phone that has very little.
	let beforeUrl = $state('');
	let afterUrl = $state('');
	$effect(() => {
		const b = URL.createObjectURL(original);
		beforeUrl = b;
		return () => URL.revokeObjectURL(b);
	});
	$effect(() => {
		const a = URL.createObjectURL(rendered.blob);
		afterUrl = a;
		return () => URL.revokeObjectURL(a);
	});

	const kb = $derived(Math.max(1, Math.round(rendered.blob.size / 1024)));
</script>

<div class="confirm">
	<p class="safety-copy">{m.confirm_intro()}</p>

	<img
		class="shot"
		src={showAfter ? afterUrl : beforeUrl}
		alt={showAfter ? m.confirm_alt_after() : m.confirm_alt_before()}
	/>

	<div class="row">
		<button type="button" class="btn-quiet" onclick={() => (showAfter = !showAfter)}>
			{showAfter ? m.redact_show_original() : m.redact_show_covered()}
		</button>
		<p class="muted meta">
			{m.redact_count({ n: rendered.coveredBoxes })} · {m.confirm_size({
				kb,
				w: rendered.width,
				h: rendered.height
			})}
		</p>
	</div>

	{#if rendered.coveredBoxes === 0}
		<p class="warn" role="status">{m.confirm_none_covered()}</p>
	{/if}

	<div class="stack">
		<button type="button" class="btn-primary" disabled={busy} onclick={onconfirm}>
			{busy ? m.processing() : m.confirm_send_ok()}
		</button>
		<button type="button" class="btn-outline" disabled={busy} onclick={onback}>
			{m.confirm_cover_more()}
		</button>
		<button type="button" class="btn-quiet" disabled={busy} onclick={onprivate}>
			{m.redact_keep_private()}
		</button>
		<p class="muted">{m.confirm_note()}</p>
	</div>
</div>

<style>
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.shot {
		width: 100%;
		height: auto;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2);
	}
	.meta {
		font-size: var(--text-sm);
	}
	.warn {
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 4px solid var(--hazard);
		border-radius: var(--r-sm);
		padding: var(--sp-3);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
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
		min-height: 48px;
		padding: var(--sp-2) var(--sp-3);
		border: 0;
		background: none;
		color: var(--text-muted);
		font: inherit;
		cursor: pointer;
	}
</style>
