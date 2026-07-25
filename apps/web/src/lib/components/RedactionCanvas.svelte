<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Box } from '$lib/pipeline/pipeline-client';
	import { HEADER_PROBE_BYTES, readImageDimensions } from '$lib/pipeline/image-header';
	import { scaledSize } from '$lib/pipeline/derivative-core';

	/**
	 * GEOMETRY EDITOR ONLY (ARCHITECTURE §19:1216).
	 *
	 * This component no longer decides what the public copy looks like. It
	 * collects normalized box coordinates on a small working copy; the worker
	 * bakes them into pixels once, at the final derivative resolution, and the
	 * human confirms THOSE bytes on the next screen. Previously the toggle here
	 * was the whole before/after confirm, which meant the user approved a
	 * display copy and something else shipped.
	 */
	let {
		imageBlob,
		boxes = $bindable([] as Box[]),
		decodeFailed = $bindable(false)
	}: { imageBlob: Blob; boxes?: Box[]; decodeFailed?: boolean } = $props();

	let canvasEl: HTMLCanvasElement;
	let bitmap: ImageBitmap | null = null;
	let showCovered = $state(true);
	let drag: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
	/**
	 * Decoding a multi-MB capture takes real time on a cheap phone, and until it
	 * finishes a drag silently does nothing. Announce that rather than looking
	 * broken: `aria-busy` tells a screen reader, and the visible hint tells
	 * everyone else.
	 */
	let ready = $state(false);

	/** Working-copy width. Big enough to aim at a face, small enough not to OOM. */
	const PREVIEW_MAX = 1024;

	function redraw() {
		if (!canvasEl || !bitmap) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		ctx.drawImage(bitmap, 0, 0, canvasEl.width, canvasEl.height);
		ctx.fillStyle = '#000000';
		if (showCovered) {
			for (const b of boxes) {
				ctx.fillRect(
					b.x * canvasEl.width,
					b.y * canvasEl.height,
					b.w * canvasEl.width,
					b.h * canvasEl.height
				);
			}
		}
		if (drag) {
			const x = Math.min(drag.x0, drag.x1);
			const y = Math.min(drag.y0, drag.y1);
			ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
		}
	}

	function localPoint(e: PointerEvent): { x: number; y: number } {
		const r = canvasEl.getBoundingClientRect();
		return {
			x: ((e.clientX - r.left) / r.width) * canvasEl.width,
			y: ((e.clientY - r.top) / r.height) * canvasEl.height
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (!bitmap) return;
		canvasEl.setPointerCapture(e.pointerId);
		const p = localPoint(e);
		drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
	}
	function onPointerMove(e: PointerEvent) {
		if (!drag) return;
		const p = localPoint(e);
		drag = { ...drag, x1: p.x, y1: p.y };
		redraw();
	}
	function onPointerUp() {
		if (!drag) return;
		const x = Math.min(drag.x0, drag.x1);
		const y = Math.min(drag.y0, drag.y1);
		const w = Math.abs(drag.x1 - drag.x0);
		const h = Math.abs(drag.y1 - drag.y0);
		drag = null;
		// Ignore accidental taps; only commit a box with real area.
		if (w > 6 && h > 6) {
			boxes = [
				...boxes,
				{
					x: x / canvasEl.width,
					y: y / canvasEl.height,
					w: w / canvasEl.width,
					h: h / canvasEl.height
				}
			];
		}
		redraw();
	}

	function removeLast() {
		boxes = boxes.slice(0, -1);
		redraw();
	}
	function clearAll() {
		boxes = [];
		redraw();
	}

	$effect(() => {
		// re-draw when the covered/original toggle flips
		showCovered;
		redraw();
	});

	/**
	 * Decode a SCALED working copy. The old code called `createImageBitmap(blob)`
	 * with no options, which fully decodes a 12-108 MP capture into RGBA on the
	 * main thread — hundreds of megabytes on a 1-2 GB phone. Dimensions come from
	 * the file header first so the scale factor is known before any pixels exist.
	 */
	async function decodePreview(blob: Blob): Promise<ImageBitmap> {
		const head = new Uint8Array(await blob.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
		const intrinsic = readImageDimensions(head);
		if (!intrinsic) return createImageBitmap(blob);
		const size = scaledSize(intrinsic.width, intrinsic.height, PREVIEW_MAX);
		try {
			return await createImageBitmap(blob, {
				resizeWidth: size.width,
				resizeHeight: size.height,
				resizeQuality: 'high'
			});
		} catch {
			return createImageBitmap(blob);
		}
	}

	onMount(() => {
		let revoked = false;
		decodePreview(imageBlob)
			.then((bm) => {
				if (revoked) {
					bm.close();
					return;
				}
				bitmap = bm;
				const maxW = Math.min(canvasEl.parentElement?.clientWidth ?? 360, 640);
				canvasEl.width = maxW;
				canvasEl.height = Math.round((bm.height / bm.width) * maxW);
				redraw();
				ready = true;
			})
			.catch(() => {
				// An unreadable image must not crash the flow, and must not let the
				// user "continue" either: the parent disables the public-copy path on
				// this flag, so the capture falls closed to vault-only.
				decodeFailed = true;
			});
		return () => {
			revoked = true;
			bitmap?.close();
		};
	});
</script>

<div class="redact">
	{#if decodeFailed}
		<p class="muted" role="status">{m.redact_decode_failed()}</p>
	{/if}
	<canvas
		bind:this={canvasEl}
		class:hidden={decodeFailed}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		aria-label={m.redact_canvas_label()}
		aria-busy={!ready && !decodeFailed}
	></canvas>
	<p class="muted redact-hint" class:hidden={decodeFailed}>
		{ready || decodeFailed ? m.redact_hint() : m.processing()}
	</p>
	<div class="redact-controls">
		<button type="button" class="btn-quiet" onclick={() => (showCovered = !showCovered)}>
			{showCovered ? m.redact_show_original() : m.redact_show_covered()}
		</button>
		<button type="button" class="btn-quiet" onclick={removeLast} disabled={boxes.length === 0}>
			{m.redact_remove_last()}
		</button>
		<button type="button" class="btn-quiet" onclick={clearAll} disabled={boxes.length === 0}>
			{m.redact_clear()}
		</button>
	</div>
	<p class="muted">{m.redact_count({ n: boxes.length })}</p>
</div>

<style>
	.redact {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	canvas {
		width: 100%;
		height: auto;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface-2);
		touch-action: none;
	}
	.redact-hint {
		font-size: var(--text-sm);
	}
	.redact-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.btn-quiet {
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
	.btn-quiet:disabled {
		opacity: 0.5;
	}
	.hidden {
		display: none;
	}
</style>
