/// <reference lib="webworker" />
/**
 * On-device media pipeline worker (ARCHITECTURE §7.5). Runs the heavy, fail-closed
 * steps off the main thread: hash the pristine original, seal it in part-aligned
 * chunks, and — only when the human confirmed redaction — bake solid-fill boxes
 * into a downscaled, metadata-free derivative. The canvas re-encode drops EXIF/GPS
 * by construction; the original keeps its bytes but is sealed, not readable.
 *
 * No console, no network, no DOM: OffscreenCanvas + WebCrypto only. Pure @noble
 * seal (no wasm). The main thread owns the redaction UI and the before/after
 * confirm; this worker never emits a derivative unless told the human confirmed.
 */
import { newContentKey } from '@harborage/crypto';
import { concatChunks, sealChunks } from '@harborage/outbox';

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
} // normalized 0..1

interface ProcessImageMsg {
	id: number;
	cmd: 'processImage';
	bytes: ArrayBuffer;
	mime: string;
	boxes: Box[];
	maxDim: number;
	emitDerivative: boolean;
}
interface SealMediaMsg {
	id: number;
	cmd: 'sealMedia';
	bytes: ArrayBuffer;
	mime: string;
}
type InMsg = ProcessImageMsg | SealMediaMsg;

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function digest(bytes: Uint8Array): Promise<{ hex: string; raw: Uint8Array }> {
	const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
	return { hex, raw };
}

async function sealBytes(
	bytes: Uint8Array
): Promise<{ sha256: string; key: Uint8Array; sealed: Uint8Array }> {
	const { hex, raw } = await digest(bytes);
	const key = newContentKey();
	// AAD base = the raw original digest, binding every chunk to this file.
	const sealed = concatChunks(sealChunks(key, bytes, raw));
	return { sha256: hex, key, sealed };
}

async function encodeDerivative(
	bitmap: ImageBitmap,
	boxes: Box[],
	maxDim: number
): Promise<{ bytes: Uint8Array; mime: string }> {
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * scale));
	const h = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d context');
	ctx.drawImage(bitmap, 0, 0, w, h);
	// Solid, opaque fill — irreversible, never a blur or mosaic.
	ctx.fillStyle = '#000000';
	for (const b of boxes) {
		ctx.fillRect(Math.floor(b.x * w), Math.floor(b.y * h), Math.ceil(b.w * w), Math.ceil(b.h * h));
	}
	let blob: Blob;
	try {
		blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.6 });
	} catch {
		blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.5 });
	}
	return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

async function processImage(msg: ProcessImageMsg) {
	const orig = new Uint8Array(msg.bytes);
	const sealed = await sealBytes(orig);
	const result: {
		original: { sha256: string; mime: string; sealed: ArrayBuffer; key: Uint8Array };
		derivative: { sha256: string; mime: string; bytes: ArrayBuffer } | null;
	} = {
		original: {
			sha256: sealed.sha256,
			mime: msg.mime,
			sealed: sealed.sealed.buffer as ArrayBuffer,
			key: sealed.key
		},
		derivative: null
	};

	if (msg.emitDerivative) {
		const bitmap = await createImageBitmap(new Blob([orig], { type: msg.mime }));
		const der = await encodeDerivative(bitmap, msg.boxes, msg.maxDim);
		bitmap.close();
		const dDigest = await digest(der.bytes);
		// Fail closed: a derivative that equals the original means re-encode was
		// skipped (metadata not stripped). Never emit it.
		if (dDigest.hex === sealed.sha256) throw new Error('derivative not re-encoded');
		result.derivative = { sha256: dDigest.hex, mime: der.mime, bytes: der.bytes.buffer as ArrayBuffer };
	}
	return result;
}

async function sealMedia(msg: SealMediaMsg) {
	const sealed = await sealBytes(new Uint8Array(msg.bytes));
	return {
		sha256: sealed.sha256,
		mime: msg.mime,
		sealed: sealed.sealed.buffer as ArrayBuffer,
		key: sealed.key
	};
}

scope.addEventListener('message', async (e: MessageEvent<InMsg>) => {
	const { id } = e.data;
	try {
		if (e.data.cmd === 'processImage') {
			const result = await processImage(e.data);
			const transfer: ArrayBuffer[] = [result.original.sealed];
			if (result.derivative) transfer.push(result.derivative.bytes);
			scope.postMessage({ id, result }, transfer);
		} else if (e.data.cmd === 'sealMedia') {
			const result = await sealMedia(e.data);
			scope.postMessage({ id, result }, [result.sealed]);
		} else {
			scope.postMessage({ id, error: 'unknown command' });
		}
	} catch (err) {
		scope.postMessage({ id, error: err instanceof Error ? err.message : 'pipeline failed' });
	}
});
