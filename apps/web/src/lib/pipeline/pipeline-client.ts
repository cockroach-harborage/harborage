/**
 * Main-thread wrapper over the pipeline worker. Spawns it as a same-origin module
 * worker (strict CSP: script-src 'self', no blob: worker), and turns the returned
 * transferable buffers back into the shapes the document store holds.
 *
 * Takes BLOBS, not ArrayBuffers. Each call reads the bytes fresh and transfers
 * them, so RAM holds one copy of a multi-MB capture at a time and the caller can
 * still show the original afterwards. The previous signature took an ArrayBuffer
 * and transferred it, which detached the caller's only copy — fine when there
 * was one call, wrong now that render and seal are separate steps and the
 * before/after confirm needs the original again.
 *
 * Redaction geometry lives in the calling component; this only moves bytes.
 */
import type { Derivative, SealedOriginal } from '$lib/documents';
import type { Box, LinkClass } from './derivative-core';
import { linkClassFrom } from './derivative-core';

export type { Box } from './derivative-core';

/** Stable failure codes from the worker, so the UI can fail closed with honest copy. */
export const PIPELINE_ERRORS = {
	decode: 'derivative_decode_failed',
	encode: 'derivative_encode_failed',
	coverage: 'derivative_coverage_unverified',
	notReencoded: 'derivative_not_reencoded'
} as const;

export type PipelineErrorCode = (typeof PIPELINE_ERRORS)[keyof typeof PIPELINE_ERRORS];

/** True when the failure means "no safe public copy could be built" -> vault-only. */
export function isDerivativeFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : '';
	return (Object.values(PIPELINE_ERRORS) as string[]).includes(msg);
}

/** The exact bytes that will ship, plus what the confirm screen needs to show. */
export interface RenderedDerivative {
	blob: Blob;
	sha256: string;
	mime: string;
	width: number;
	height: number;
	coveredBoxes: number;
}

let worker: Worker | null = null;
let seq = 0;

// Trusted Types is enforced on every page (_headers). The Worker constructor is
// a TrustedScriptURL sink, and Vite requires the `new Worker(new URL(...))`
// literal to bundle the worker (so we cannot wrap the URL). We instead register
// a narrow `default` Trusted Types policy that passes through SAME-ORIGIN script
// URLs (our own bundled worker) and nothing else: it implements only
// createScriptURL, so HTML/eval sinks (innerHTML, Function) stay blocked.
let ttReady = false;
interface TrustedTypesLike {
	createPolicy(name: string, rules: { createScriptURL(u: string): string }): unknown;
	defaultPolicy?: unknown;
}
function ensureTrustedTypes(): void {
	if (ttReady) return;
	ttReady = true;
	const tt = (globalThis as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
	if (!tt?.createPolicy || tt.defaultPolicy) return;
	try {
		tt.createPolicy('default', {
			createScriptURL(u: string) {
				if (new URL(u, location.origin).origin !== location.origin)
					throw new Error('cross-origin script url blocked');
				return u;
			}
		});
	} catch {
		// a default policy already exists — fine
	}
}

function getWorker(): Worker {
	if (!worker) {
		ensureTrustedTypes();
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

/** Link class for this device right now. Unknown defaults to slow (see derivative-core). */
export function currentLinkClass(): LinkClass {
	const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } })
		.connection;
	return linkClassFrom(conn);
}

/**
 * Render the public copy: downscale, bake the solid fill at the FINAL
 * resolution, encode, and verify the covered regions in the encoded bytes.
 *
 * The returned blob is the artifact. The confirm screen shows exactly this, and
 * exactly this is what commits — there is no re-render between the two.
 */
export async function renderDerivative(
	source: Blob,
	boxes: Box[],
	link: LinkClass = currentLinkClass()
): Promise<RenderedDerivative> {
	// boxes may be a Svelte $state proxy; postMessage cannot structured-clone a
	// proxy, so send plain objects.
	const plainBoxes = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
	const bytes = await source.arrayBuffer();
	const raw = await call<{
		bytes: ArrayBuffer;
		mime: string;
		sha256: string;
		width: number;
		height: number;
		coveredBoxes: number;
	}>(
		{ cmd: 'renderDerivative', bytes, mime: source.type || 'image/jpeg', boxes: plainBoxes, link },
		[bytes]
	);
	return {
		blob: new Blob([raw.bytes], { type: raw.mime }),
		sha256: raw.sha256,
		mime: raw.mime,
		width: raw.width,
		height: raw.height,
		coveredBoxes: raw.coveredBoxes
	};
}

/** Hash and seal the pristine original. Always runs, for photo and audio alike. */
export async function sealOriginal(source: Blob, mime?: string): Promise<SealedOriginal> {
	const bytes = await source.arrayBuffer();
	const raw = await call<{ sha256: string; mime: string; sealed: ArrayBuffer; key: Uint8Array }>(
		{ cmd: 'sealOriginal', bytes, mime: mime ?? source.type ?? 'application/octet-stream' },
		[bytes]
	);
	return {
		sha256: raw.sha256,
		mime: raw.mime,
		sealed: new Blob([raw.sealed]),
		key: raw.key
	};
}

/** Adapt a rendered derivative into the stored shape. */
export function toDerivative(rendered: RenderedDerivative): Derivative {
	return { sha256: rendered.sha256, mime: rendered.mime, blob: rendered.blob };
}
