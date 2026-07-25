/**
 * Probe a video and draw one keyframe (ARCHITECTURE §7.5:340, §19:1319).
 *
 * Main thread only: `OffscreenCanvas` cannot decode video, so this needs a real
 * `<video>` element. The still it produces is handed to the EXISTING
 * `renderDerivative`, so cover, human confirm, downscale, encode and the 3 px
 * coverage assertion are literally the same code path a photo takes. One
 * pipeline means nothing can drift between the two.
 *
 * FAILS CLOSED, LOUDLY. iPhone-origin HEVC and some high-bitrate H.264 will not
 * decode in Android WebView, and the failure is not always an error: the element
 * can fire `seeked` and let `drawImage` succeed while producing a black frame.
 * So a drawn frame is measured, and a flat one is a failure rather than a
 * poster. There is no silent missing-poster path.
 */
import {
	BLANK_FRAME_LUMA_RANGE,
	codecFromContainer,
	isBlankFrame,
	POSTER_PROBE_TIMEOUT_MS,
	POSTER_SEEK_SECONDS,
	type PosterOutcome
} from './video-core';

export interface PosterResult {
	outcome: PosterOutcome;
	/** The drawn keyframe, present only when the outcome is 'built'. */
	frame?: Blob;
}

/** Luma spread of a sample of pixels: max minus min. */
function lumaSpread(data: Uint8ClampedArray): number {
	let min = 255;
	let max = 0;
	// Sample rather than sweep: a 1080p frame is 8 MB of RGBA and the answer
	// does not change.
	const stride = Math.max(4, Math.floor(data.length / 4 / 4096) * 4);
	for (let i = 0; i < data.length; i += stride) {
		const luma = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
		if (luma < min) min = luma;
		if (luma > max) max = luma;
	}
	return max - min;
}

export async function extractPosterFrame(video: Blob): Promise<PosterResult> {
	const header = new Uint8Array(await video.slice(0, 64).arrayBuffer());
	const codec = codecFromContainer(header);
	const url = URL.createObjectURL(video);
	const el = document.createElement('video');
	el.muted = true;
	el.playsInline = true;
	el.preload = 'auto';

	try {
		const drawn = await new Promise<ImageData | null>((resolve) => {
			let settled = false;
			const finish = (v: ImageData | null) => {
				if (settled) return;
				settled = true;
				resolve(v);
			};
			const timer = setTimeout(() => finish(null), POSTER_PROBE_TIMEOUT_MS);

			el.onerror = () => {
				clearTimeout(timer);
				finish(null);
			};
			el.onloadedmetadata = () => {
				// Frame zero is often a black lead-in on phone captures, so seek in a
				// little — but never past a very short clip.
				el.currentTime = Math.min(POSTER_SEEK_SECONDS, Math.max(0, (el.duration || 0) / 2));
			};
			el.onseeked = () => {
				clearTimeout(timer);
				try {
					const canvas = document.createElement('canvas');
					canvas.width = el.videoWidth;
					canvas.height = el.videoHeight;
					if (!canvas.width || !canvas.height) return finish(null);
					const ctx = canvas.getContext('2d', { willReadFrequently: true });
					if (!ctx) return finish(null);
					ctx.drawImage(el, 0, 0);
					finish(ctx.getImageData(0, 0, canvas.width, canvas.height));
				} catch {
					finish(null);
				}
			};
			el.src = url;
		});

		if (!drawn) {
			return { outcome: { kind: 'decode_failed', codec, reason: 'no_decode' } };
		}
		if (isBlankFrame(lumaSpread(drawn.data))) {
			// The frame decoded to nothing usable. Shipping it would be publishing a
			// black rectangle as evidence.
			return { outcome: { kind: 'decode_failed', codec, reason: 'blank_frame' } };
		}

		const canvas = document.createElement('canvas');
		canvas.width = drawn.width;
		canvas.height = drawn.height;
		canvas.getContext('2d')!.putImageData(drawn, 0, 0);
		const frame = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
		if (!frame) return { outcome: { kind: 'decode_failed', codec, reason: 'no_decode' } };
		return { outcome: { kind: 'built', codec }, frame };
	} finally {
		el.removeAttribute('src');
		el.load();
		URL.revokeObjectURL(url);
	}
}

export { BLANK_FRAME_LUMA_RANGE };
