<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Box } from '$lib/pipeline/pipeline-client';

	let { imageBlob, boxes = $bindable([] as Box[]) }: { imageBlob: Blob; boxes?: Box[] } = $props();

	let canvasEl: HTMLCanvasElement;
	let bitmap: ImageBitmap | null = null;
	let showCovered = $state(true);
	let decodeFailed = $state(false);
	let drag: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);

	function redraw() {
		if (!canvasEl || !bitmap) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		ctx.drawImage(bitmap, 0, 0, canvasEl.width, canvasEl.height);
		ctx.fillStyle = '#000000';
		if (showCovered) {
			for (const b of boxes) {
				ctx.fillRect(b.x * canvasEl.width, b.y * canvasEl.height, b.w * canvasEl.width, b.h * canvasEl.height);
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
				{ x: x / canvasEl.width, y: y / canvasEl.height, w: w / canvasEl.width, h: h / canvasEl.height }
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

	onMount(() => {
		let revoked = false;
		createImageBitmap(imageBlob)
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
			})
			.catch(() => {
				// An unreadable image must not crash the flow; the user can still keep
				// it private (sealed, byte-for-byte) or pick another photo.
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
	></canvas>
	<p class="muted redact-hint" class:hidden={decodeFailed}>{m.redact_hint()}</p>
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
