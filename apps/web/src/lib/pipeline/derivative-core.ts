/**
 * Derivative sizing, quality, and cover-box geometry (ARCHITECTURE §19).
 *
 * PURE BY CONSTRUCTION: no imports, no DOM, no globals, so every rule here is
 * unit-testable under `apps/web/vitest.config.ts` (which has no `$lib` alias and
 * no DOM). The worker owns the pixels; this owns the arithmetic that decides
 * what the pixels should be, which is where the safety-relevant mistakes live.
 *
 * Two §19 rules are encoded here rather than described in a comment:
 *
 *  - The legibility floor is a FLOOR, not a target (§19:1240). A badge number,
 *    banner or official's face must stay readable. If a byte target and the
 *    floor conflict, legibility wins and the derivative simply gets bigger.
 *  - Cover boxes round OUTWARD (§19:1216). Rounding a box inward by even one
 *    pixel uncovers a sliver of a face nobody reviewed, so origin floors and
 *    extent ceils, always.
 */

/** Slow/fast only. §19:1233 collapses the older three-tier ladder deliberately. */
export type LinkClass = 'slow' | 'fast';

/**
 * The hard legibility floor. Never produce a public copy whose long edge is
 * below this, unless the source itself is already smaller (we never upscale —
 * inventing pixels does not add legibility, it only adds bytes).
 */
export const LEGIBILITY_MIN_LONG_EDGE = 1280;

/** Fast-link ceiling. Above this the extra bytes buy no evidentiary value. */
export const MAX_LONG_EDGE = 2048;

/** The lowest quality §19:1240 permits, expressed on the 0..1 encoder scale. */
export const MIN_QUALITY = 0.35;

/**
 * Link class from whatever `navigator.connection` offers.
 *
 * Takes a plain object so it stays pure and testable. Honest simplification:
 * §19 specifies an EWMA measured-throughput fallback for iOS and any browser
 * without the API, but there is no upload history on a first capture, so an
 * EWMA would be seeded with a guess and dressed up as a measurement. We default
 * UNKNOWN TO SLOW instead. That is the safer failure — a smaller file on a link
 * that might be 2G — and it costs legibility nothing, because the floor above
 * is what actually bounds quality.
 */
export function linkClassFrom(
	conn: { effectiveType?: string; saveData?: boolean } | null | undefined
): LinkClass {
	if (!conn) return 'slow';
	if (conn.saveData === true) return 'slow';
	const t = conn.effectiveType;
	if (t === '4g') return 'fast';
	if (t === '3g') return 'fast';
	if (t === '2g' || t === 'slow-2g') return 'slow';
	return 'slow';
}

/**
 * Target long edge for the derivative.
 *
 * Never upscales, and never returns below the legibility floor unless the
 * source is already smaller than the floor.
 */
export function targetLongEdge(link: LinkClass, intrinsicLongEdge: number): number {
	if (!Number.isFinite(intrinsicLongEdge) || intrinsicLongEdge < 1) return LEGIBILITY_MIN_LONG_EDGE;
	const wanted = link === 'slow' ? LEGIBILITY_MIN_LONG_EDGE : MAX_LONG_EDGE;
	const floored = Math.max(wanted, LEGIBILITY_MIN_LONG_EDGE);
	return Math.min(floored, Math.round(intrinsicLongEdge));
}

/** Encoder quality by link class, clamped to the floor. */
export function encodeQuality(link: LinkClass): number {
	return Math.max(MIN_QUALITY, link === 'slow' ? 0.45 : 0.6);
}

/** Scaled output size preserving aspect, at least 1x1. */
export function scaledSize(
	width: number,
	height: number,
	longEdge: number
): { width: number; height: number } {
	const maxSide = Math.max(width, height);
	const scale = maxSide > 0 ? Math.min(1, longEdge / maxSide) : 1;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/** A normalized 0..1 cover box, as authored on the geometry canvas. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface PixelRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Normalized box -> pixel rect at the FINAL derivative resolution, rounding
 * outward and clamped to the canvas.
 *
 * Outward rounding is the whole point: the origin floors and the extent ceils,
 * so the painted rectangle is never smaller than what the user drew. A box that
 * shrank by a pixel would leave an uncovered sliver of a face that nobody
 * reviewed, which §19:1216 calls out by name.
 */
export function boxToPixels(box: Box, width: number, height: number): PixelRect | null {
	if (!(box.w > 0) || !(box.h > 0)) return null;
	const x0 = Math.floor(box.x * width);
	const y0 = Math.floor(box.y * height);
	const x1 = Math.ceil((box.x + box.w) * width);
	const y1 = Math.ceil((box.y + box.h) * height);
	const cx0 = Math.max(0, Math.min(width, x0));
	const cy0 = Math.max(0, Math.min(height, y0));
	const cx1 = Math.max(0, Math.min(width, x1));
	const cy1 = Math.max(0, Math.min(height, y1));
	if (cx1 <= cx0 || cy1 <= cy0) return null;
	return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}

/**
 * Inset, in pixels, when sampling a painted box to verify it really is filled.
 *
 * FIXED, not proportional, and that distinction is load-bearing. Lossy ringing
 * at a hard edge is a fixed-scale artefact of the codec: it does not grow with
 * the box. An earlier version here inset by 8% of the box, which passed every
 * test and was badly wrong — on a 700px box that skips a 56px band inside the
 * region the human confirmed, so a paint offset of tens of pixels along an edge
 * would leave part of a face uncovered and still verify clean. Caught by
 * deliberately sabotaging the paint offset and watching nothing fail.
 *
 * 3px clears ringing while keeping the checked region flush against what was
 * confirmed.
 */
export const COVERAGE_INSET_PX = 3;

/**
 * The region of a painted box that is safe to SAMPLE when verifying coverage.
 *
 * Never returns less than a 1x1 centre sample, so even a tiny distant-face box
 * is still checked rather than skipped. Skipping is how a verification step
 * quietly becomes decorative.
 */
export function coverageSampleRect(rect: PixelRect): PixelRect {
	const i = Math.max(
		0,
		Math.min(COVERAGE_INSET_PX, Math.floor((Math.min(rect.w, rect.h) - 1) / 2))
	);
	const w = Math.max(1, rect.w - 2 * i);
	const h = Math.max(1, rect.h - 2 * i);
	return { x: rect.x + i, y: rect.y + i, w, h };
}

/** Solid fill colour. Opaque black: irreversible, never a blur or a mosaic. */
export const FILL_RGB = { r: 0, g: 0, b: 0 } as const;

/**
 * Per-channel tolerance when checking that a sampled pixel really is the fill.
 *
 * Sized for lossy re-encode drift on a solid black region, not chosen to make a
 * failing case pass. `apps/web/e2e/redaction-pixels.test.ts` asserts that a box
 * shifted by a few pixels still FAILS at this tolerance, so the number cannot
 * quietly drift upward until the check stops meaning anything.
 */
export const FILL_TOLERANCE = 24;

/** At most this many pixels sampled per box, strided. Keeps the check O(1)-ish. */
export const MAX_SAMPLES_PER_BOX = 512;

/** Stride so a large box is sampled evenly without reading every pixel. */
export function sampleStride(rect: PixelRect, maxSamples = MAX_SAMPLES_PER_BOX): number {
	const total = rect.w * rect.h;
	if (total <= maxSamples) return 1;
	return Math.max(1, Math.ceil(Math.sqrt(total / maxSamples)));
}

/** True when a sampled pixel is within tolerance of the solid fill. */
export function isFillPixel(r: number, g: number, b: number, tolerance = FILL_TOLERANCE): boolean {
	return (
		Math.abs(r - FILL_RGB.r) <= tolerance &&
		Math.abs(g - FILL_RGB.g) <= tolerance &&
		Math.abs(b - FILL_RGB.b) <= tolerance
	);
}
