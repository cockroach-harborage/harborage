/// <reference lib="webworker" />
/**
 * On-device media pipeline worker (ARCHITECTURE §19, which supersedes §7.5).
 *
 * §19 fixes the step order, and the order is the safety property:
 *
 *   ingest -> encrypted crash-quarantine -> read intrinsic dimensions CHEAPLY
 *   -> decode+downscale to the FINAL derivative resolution -> bake the solid
 *   fill at that resolution -> render the exact bytes that will ship and run
 *   the human before/after confirm on THOSE bytes -> strip metadata (implicit
 *   in the canvas re-encode) -> hash the derivative -> hash the pristine
 *   original -> seal the original -> commit both.
 *
 * TWO THINGS THE M1 IMPLEMENTATION GOT WRONG, both fixed here:
 *
 * 1. It confirmed on a display working copy and then re-applied the box
 *    geometry through a second render path at derivative resolution. §19:1216
 *    forbids exactly that by name: "coordinate rounding there can shift a box a
 *    few pixels and under-cover a face nobody reviewed." There is now ONE
 *    render. `renderDerivative` returns the encoded bytes, the human confirms
 *    those bytes, and those same bytes are what commit. No second path exists
 *    to drift.
 *
 * 2. It called `createImageBitmap(blob)` with no resize options — an unbounded
 *    full decode. A 108 MP photo is ~432 MB of RGBA on a phone with 1-2 GB of
 *    RAM. Dimensions now come from the file header (or `ImageDecoder`), and the
 *    decode is scaled where the engine supports it, probed rather than assumed.
 *
 * DELIBERATE DEVIATION FROM §19's LITERAL ORDER, stated so it is reviewable:
 * §19 puts the crash-quarantine copy at step 1 and the seal at step 9. Sealing
 * twice would cost a second XChaCha20 pass over a multi-MB file on the weakest
 * device we support, so the original is sealed ONCE, up front, and the same
 * ciphertext serves as both the crash-quarantine copy and the vault artifact.
 * This satisfies §19's second invariant more strongly, not less: the pristine
 * original is hashed and sealed before the derivative branch can fail at all.
 *
 * No console, no network, no DOM: OffscreenCanvas + WebCrypto only. Pure @noble
 * seal, no wasm.
 */
import { newContentKey } from '@harborage/crypto';
import { concatChunks, sealChunks } from '@harborage/outbox';
import {
	boxToPixels,
	coverageSampleRect,
	encodeQuality,
	isFillPixel,
	sampleStride,
	scaledSize,
	targetLongEdge,
	LEGIBILITY_MIN_LONG_EDGE,
	type Box,
	type LinkClass,
	type PixelRect
} from './derivative-core.ts';
import { HEADER_PROBE_BYTES, readImageDimensions, type Dimensions } from './image-header.ts';

/**
 * Failure codes. The UI must distinguish "we could not build a safe public
 * copy" (fail closed to vault-only, with honest copy) from a generic error, so
 * these travel as stable codes rather than free text.
 */
export const PIPELINE_ERRORS = {
	decode: 'derivative_decode_failed',
	encode: 'derivative_encode_failed',
	coverage: 'derivative_coverage_unverified',
	notReencoded: 'derivative_not_reencoded'
} as const;

interface RenderDerivativeMsg {
	id: number;
	cmd: 'renderDerivative';
	bytes: ArrayBuffer;
	mime: string;
	boxes: Box[];
	link: LinkClass;
}
interface SealOriginalMsg {
	id: number;
	cmd: 'sealOriginal';
	bytes: ArrayBuffer;
	mime: string;
}
type InMsg = RenderDerivativeMsg | SealOriginalMsg;

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function digest(bytes: Uint8Array): Promise<{ hex: string; raw: Uint8Array }> {
	const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
	return { hex, raw };
}

// --- Step 8/9: hash and seal the pristine original ---------------------------

async function sealOriginal(msg: SealOriginalMsg) {
	const bytes = new Uint8Array(msg.bytes);
	const { hex, raw } = await digest(bytes);
	const key = newContentKey();
	// AAD base = the raw original digest, binding every chunk to this file.
	const sealed = concatChunks(sealChunks(key, bytes, raw));
	return { sha256: hex, mime: msg.mime, sealed: sealed.buffer as ArrayBuffer, key };
}

// --- Step 2: intrinsic dimensions, without allocating the pixels -------------

interface ImageDecoderLike {
	tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } | null };
	decode(): Promise<{ image: { displayWidth: number; displayHeight: number; close(): void } }>;
	close(): void;
}

async function intrinsicDimensions(blob: Blob, head: Uint8Array): Promise<Dimensions> {
	const parsed = readImageDimensions(head);
	if (parsed) return parsed;

	// HEIC/AVIF and anything the header parser declines: ask the platform's own
	// decoder for metadata. Still not a full decode of our own making.
	const Ctor = (globalThis as unknown as { ImageDecoder?: new (init: unknown) => ImageDecoderLike })
		.ImageDecoder;
	if (Ctor) {
		let dec: ImageDecoderLike | null = null;
		try {
			dec = new Ctor({ data: blob.stream(), type: blob.type || 'image/jpeg' });
			await dec.tracks.ready;
			const { image } = await dec.decode();
			const dims = { width: image.displayWidth, height: image.displayHeight };
			image.close();
			if (dims.width > 0 && dims.height > 0) return dims;
		} catch {
			// fall through
		} finally {
			try {
				dec?.close();
			} catch {
				/* already closed */
			}
		}
	}

	// Last resort: a full decode. Documented as the memory-risky path rather
	// than silently being the default, which is what it used to be.
	const bitmap = await createImageBitmap(blob);
	const dims = { width: bitmap.width, height: bitmap.height };
	bitmap.close();
	return dims;
}

// --- Step 3: decode AND downscale in one memory-frugal step ------------------

async function decodeScaled(blob: Blob, size: { width: number; height: number }) {
	try {
		return await createImageBitmap(blob, {
			resizeWidth: size.width,
			resizeHeight: size.height,
			resizeQuality: 'high'
		});
	} catch {
		// Some engines reject the resize options outright. Correctness does not
		// depend on them: the drawImage below passes explicit destination width
		// and height, so an engine that ignores or refuses the hint still produces
		// the same pixels. What is lost is only the memory saving, which is why
		// this is a fallback and not the default path.
		return createImageBitmap(blob);
	}
}

// --- Steps 4-6: bake at final resolution, then encode ------------------------

async function encodeCanvas(
	canvas: OffscreenCanvas,
	quality: number
): Promise<{ bytes: Uint8Array; mime: string }> {
	// WebP with a JPEG fallback only. §19:1238 drops client-side AVIF: it is the
	// least-supported, slowest, most crash-prone encode on low-end WebView, and
	// it buys nothing durable because the archive re-derives an AVIF master
	// server-side from this already-covered derivative.
	for (const type of ['image/webp', 'image/jpeg']) {
		try {
			const blob = await canvas.convertToBlob({ type, quality });
			if (blob && blob.size > 0) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
		} catch {
			// try the next codec
		}
	}
	throw new Error(PIPELINE_ERRORS.encode);
}

/**
 * Verify the confirmed box regions really are solid fill in the SHIPPED bytes.
 *
 * §19:1319 is explicit that `derivative_sha256 !== original_sha256` is only a
 * cheap "an encode actually ran" check and is NOT the redaction guarantee. The
 * guarantee is the human confirm on the final bytes plus "an assertion that the
 * confirmed box regions are present in the shipped derivative" — this function.
 *
 * It re-decodes the encoded bytes rather than reading back the canvas we drew,
 * because the canvas is not what ships. Anything between the fill and the file
 * (a codec bug, a colour transform, a subsampling artefact) has to survive this
 * to reach a user.
 *
 * Fails closed: any box that cannot be verified aborts the whole derivative and
 * the item becomes vault-only.
 */
async function assertCoverage(
	bytes: Uint8Array,
	mime: string,
	rects: PixelRect[],
	width: number,
	height: number
): Promise<void> {
	if (rects.length === 0) return;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
	} catch {
		throw new Error(PIPELINE_ERRORS.coverage);
	}
	try {
		if (bitmap.width !== width || bitmap.height !== height)
			throw new Error(PIPELINE_ERRORS.coverage);
		const check = new OffscreenCanvas(width, height);
		const ctx = check.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error(PIPELINE_ERRORS.coverage);
		ctx.drawImage(bitmap, 0, 0);
		for (const rect of rects) {
			const sample = coverageSampleRect(rect);
			const data = ctx.getImageData(sample.x, sample.y, sample.w, sample.h).data;
			const stride = sampleStride(sample);
			// The LAST index on each axis is always included. A plain `i += stride`
			// loop stops short of the far edge, which would leave the bottom and
			// right sides of a large box unchecked — the same class of blind spot
			// as insetting proportionally.
			const axis = (n: number) => {
				const out: number[] = [];
				for (let i = 0; i < n; i += stride) out.push(i);
				if (out[out.length - 1] !== n - 1) out.push(n - 1);
				return out;
			};
			const xs = axis(sample.w);
			const ys = axis(sample.h);
			for (const y of ys) {
				for (const x of xs) {
					const o = (y * sample.w + x) * 4;
					if (!isFillPixel(data[o]!, data[o + 1]!, data[o + 2]!))
						throw new Error(PIPELINE_ERRORS.coverage);
				}
			}
		}
	} finally {
		bitmap.close();
	}
}

async function renderDerivative(msg: RenderDerivativeMsg) {
	const bytes = new Uint8Array(msg.bytes);
	const blob = new Blob([bytes as BlobPart], { type: msg.mime });

	let intrinsic: Dimensions;
	try {
		intrinsic = await intrinsicDimensions(blob, bytes.subarray(0, HEADER_PROBE_BYTES));
	} catch {
		throw new Error(PIPELINE_ERRORS.decode);
	}

	const longEdge = targetLongEdge(msg.link, Math.max(intrinsic.width, intrinsic.height));
	const size = scaledSize(intrinsic.width, intrinsic.height, longEdge);

	let bitmap: ImageBitmap;
	try {
		bitmap = await decodeScaled(blob, size);
	} catch {
		throw new Error(PIPELINE_ERRORS.decode);
	}

	let encoded: { bytes: Uint8Array; mime: string };
	const rects: PixelRect[] = [];
	try {
		const canvas = new OffscreenCanvas(size.width, size.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error(PIPELINE_ERRORS.encode);
		ctx.drawImage(bitmap, 0, 0, size.width, size.height);

		// Bake the cover boxes AT THE FINAL RESOLUTION. This is the only place
		// geometry is turned into pixels, so there is no second path to drift.
		ctx.fillStyle = '#000000';
		for (const box of msg.boxes) {
			const rect = boxToPixels(box, size.width, size.height);
			if (!rect) continue;
			rects.push(rect);
			ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
		}

		encoded = await encodeCanvas(canvas, encodeQuality(msg.link));
	} finally {
		bitmap.close();
	}

	await assertCoverage(encoded.bytes, encoded.mime, rects, size.width, size.height);

	const der = await digest(encoded.bytes);
	const orig = await digest(bytes);
	// Cheap "an encode actually ran" check only — NOT the redaction guarantee
	// (§19:1319). Two byte streams differ even if only metadata was stripped.
	if (der.hex === orig.hex) throw new Error(PIPELINE_ERRORS.notReencoded);

	return {
		bytes: encoded.bytes.buffer as ArrayBuffer,
		mime: encoded.mime,
		sha256: der.hex,
		width: size.width,
		height: size.height,
		coveredBoxes: rects.length,
		belowLegibilityFloor: longEdge < LEGIBILITY_MIN_LONG_EDGE
	};
}

scope.addEventListener('message', async (e: MessageEvent<InMsg>) => {
	const { id } = e.data;
	try {
		if (e.data.cmd === 'renderDerivative') {
			const result = await renderDerivative(e.data);
			scope.postMessage({ id, result }, [result.bytes]);
		} else if (e.data.cmd === 'sealOriginal') {
			const result = await sealOriginal(e.data);
			scope.postMessage({ id, result }, [result.sealed]);
		} else {
			scope.postMessage({ id, error: 'unknown command' });
		}
	} catch (err) {
		scope.postMessage({ id, error: err instanceof Error ? err.message : 'pipeline failed' });
	}
});
