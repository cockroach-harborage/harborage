/**
 * Video disposition (ARCHITECTURE §7.5:338-342, §19:1314-1319).
 *
 * The client does NOT transcode video and does NOT offer on-device face cover.
 * WebCodecs is patchy on exactly the low-end devices high-risk users carry, and
 * per-frame cover in a browser is unreliable, so promising it would be a safety
 * lie. Video needing redaction therefore fails closed to SEALED_ONLY, and the
 * only day-1 public artifact is a redacted POSTER KEYFRAME run through the
 * existing still pipeline.
 *
 * "VIDEO NEVER BECOMES PUBLIC" IS A PROPERTY OF THE TYPE, NOT A BRANCH.
 * `videoDisposition` returns the literal 'SEALED_ONLY' in its return type, so
 * no input produces a public video and no future `else` can add one without
 * changing the signature and every caller with it.
 *
 * Pure and import-free, for apps/web's DOM-less vitest config.
 */

export type PosterFailure = 'no_decode' | 'blank_frame' | 'timeout';

export type PosterOutcome =
	| { kind: 'built'; codec: string }
	| { kind: 'decode_failed'; codec: string; reason: PosterFailure };

export interface VideoDisposition {
	admission: 'SEALED_ONLY';
	publicArtifact: 'poster' | 'none';
}

export function videoDisposition(poster: PosterOutcome | null): VideoDisposition {
	// Note the shape: the poster only ever moves `publicArtifact`. There is no
	// value of `poster` that changes `admission`.
	return {
		admission: 'SEALED_ONLY',
		publicArtifact: poster?.kind === 'built' ? 'poster' : 'none'
	};
}

/** How long to wait for a seek before calling the decode failed. */
export const POSTER_PROBE_TIMEOUT_MS = 4_000;
/** Seek target. Frame zero is often a black lead-in on phone captures. */
export const POSTER_SEEK_SECONDS = 1.0;

/**
 * Luma spread below which a drawn frame is treated as no frame at all.
 *
 * THE NON-OBVIOUS FAILURE. Android WebView will happily draw an all-black
 * canvas from a video it could not decode: `seeked` fires, `drawImage` returns
 * without error, and the "poster" is a black rectangle. A naive implementation
 * ships it and reports success, which is precisely the silent missing poster
 * §19:1319 says must never happen. So the probe measures the drawn frame's luma
 * spread and treats a flat histogram as a decode failure.
 *
 * A genuinely near-black frame from a real night-time capture is also rejected.
 * That is the right trade: the cost is one honest "we could not make a still"
 * on a frame that would have been useless anyway, and the alternative is
 * publishing a black rectangle as evidence.
 */
export const BLANK_FRAME_LUMA_RANGE = 4;

export function isBlankFrame(histogramSpread: number): boolean {
	return histogramSpread <= BLANK_FRAME_LUMA_RANGE;
}

/**
 * Best-effort codec name from a container header. A CODEC, never a handset:
 * a device string is a fingerprint, and it would be the one identifying field
 * in an otherwise clean provenance row.
 */
export function codecFromContainer(headerBytes: Uint8Array): string {
	// ISO-BMFF: 'ftyp' at offset 4, brand at 8.
	if (
		headerBytes.length >= 12 &&
		headerBytes[4] === 0x66 &&
		headerBytes[5] === 0x74 &&
		headerBytes[6] === 0x79 &&
		headerBytes[7] === 0x70
	) {
		const brand = String.fromCharCode(
			headerBytes[8]!,
			headerBytes[9]!,
			headerBytes[10]!,
			headerBytes[11]!
		);
		if (brand === 'qt  ') return 'quicktime';
		// The iPhone default, and the one Android WebView most often cannot read.
		if (brand.startsWith('hev') || brand === 'heic' || brand === 'heim') return 'hevc';
		if (brand.startsWith('av0')) return 'av1';
		if (brand.startsWith('iso') || brand.startsWith('mp4') || brand === 'M4V ') return 'avc';
		return `mp4:${brand.trim()}`;
	}
	// Matroska / WebM: EBML magic.
	if (
		headerBytes.length >= 4 &&
		headerBytes[0] === 0x1a &&
		headerBytes[1] === 0x45 &&
		headerBytes[2] === 0xdf &&
		headerBytes[3] === 0xa3
	) {
		return 'webm';
	}
	return 'unknown';
}
