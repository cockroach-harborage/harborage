/**
 * Main-thread wrapper over the pipeline worker. Spawns it as a same-origin module
 * worker (strict CSP: script-src 'self', no blob: worker), and turns the returned
 * transferable buffers back into the SealedOriginal / Derivative shapes the record
 * store holds. Redaction UI lives in the calling component; this only moves bytes.
 */
import type { Derivative, SealedOriginal } from '$lib/records';

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ProcessedImage {
	original: SealedOriginal;
	derivative: Derivative | null;
}

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' });
	}
	return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
	const w = getWorker();
	const id = ++seq;
	return new Promise<T>((resolve, reject) => {
		const onMessage = (e: MessageEvent) => {
			if (e.data?.id !== id) return;
			w.removeEventListener('message', onMessage);
			if (e.data.error) reject(new Error(e.data.error));
			else resolve(e.data.result as T);
		};
		w.addEventListener('message', onMessage);
		w.postMessage({ ...msg, id }, transfer);
	});
}

interface RawSealed {
	sha256: string;
	mime: string;
	sealed: ArrayBuffer;
	key: Uint8Array;
}

/** Hash + seal the original and, if confirmed, bake a redacted downscaled derivative. */
export async function processImage(
	bytes: ArrayBuffer,
	mime: string,
	boxes: Box[],
	emitDerivative: boolean,
	maxDim = 1600
): Promise<ProcessedImage> {
	// boxes may be a Svelte $state proxy; postMessage cannot structured-clone a
	// proxy, so send plain objects.
	const plainBoxes = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
	const raw = await call<{
		original: RawSealed;
		derivative: { sha256: string; mime: string; bytes: ArrayBuffer } | null;
	}>({ cmd: 'processImage', bytes, mime, boxes: plainBoxes, maxDim, emitDerivative }, [bytes]);
	return {
		original: {
			sha256: raw.original.sha256,
			mime: raw.original.mime,
			sealed: new Blob([raw.original.sealed]),
			key: raw.original.key
		},
		derivative: raw.derivative
			? {
					sha256: raw.derivative.sha256,
					mime: raw.derivative.mime,
					blob: new Blob([raw.derivative.bytes], { type: raw.derivative.mime })
				}
			: null
	};
}

/** Hash + seal a non-image original (audio); no public derivative day-1. */
export async function sealMedia(bytes: ArrayBuffer, mime: string): Promise<SealedOriginal> {
	const raw = await call<RawSealed>({ cmd: 'sealMedia', bytes, mime }, [bytes]);
	return { sha256: raw.sha256, mime: raw.mime, sealed: new Blob([raw.sealed]), key: raw.key };
}
