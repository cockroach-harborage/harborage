/**
 * The outbox runner's decisions, tested where they live (ARCHITECTURE §19).
 *
 * Each describe block below guards one property that is a safety claim rather
 * than a preference: what the runner may touch without a person, how fast it may
 * go on a bad link, whether a transient failure discards an upload, and whether
 * the UI may say the vault holds something it does not.
 */
import { describe, expect, it } from 'vitest';
import { concurrencyFor, type OutboxItem } from '@harborage/outbox/types';
import {
	backingBytesMissing,
	completeStatusOutcome,
	evaluateStorage,
	FLUSH_JITTER_MS,
	flushJitterMs,
	formatMb,
	MAX_RETRY_DELAY_MS,
	nextRetryAt,
	progressFor,
	runnability,
	selectRunnable,
	storageBlocks,
	uploadLinkFrom,
	vaultedBytes
} from '../src/lib/outbox-core.ts';

const PART = 5 * 1024 * 1024;
const NOW = 1_700_000_000_000;

function item(over: Partial<OutboxItem> = {}): OutboxItem {
	return {
		id: 'i1',
		state: 'registered',
		incidentReceipt: 'receipt-1',
		derivative: { sha256: 'd'.repeat(64), size: 200_000, mime: 'image/webp', uploaded: true },
		original: { sha256: 'o'.repeat(64), size: PART * 3, mime: 'image/jpeg' },
		originalStatus: 'on_device_only',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: NOW - 1000,
		maxAge: 30 * 86_400_000,
		...over
	};
}

describe('picking what to run', () => {
	it('never flushes an item that has no receipt, because register needs a live check', () => {
		const verdict = runnability(item({ incidentReceipt: undefined, state: 'queued' }), NOW);
		expect(verdict.run).toBe(false);
		expect(verdict.reason).toBe('needs_you');
	});

	it('runs an item that already holds a receipt with no check at all', () => {
		expect(runnability(item(), NOW).run).toBe(true);
	});

	it('holds an item back until its retry time passes', () => {
		const waiting = item({ nextEarliestRetry: NOW + 1 });
		expect(runnability(waiting, NOW).reason).toBe('backing_off');
		expect(runnability(waiting, NOW + 1).run).toBe(true);
	});

	it('stops picking an item up after maxAge and changes nothing about it', () => {
		const old = item({ createdAt: NOW - 40 * 86_400_000 });
		const verdict = runnability(old, NOW);
		expect(verdict.run).toBe(false);
		expect(verdict.reason).toBe('expired');
		// The status is untouched: maxAge bounds retrying, not retention.
		expect(old.originalStatus).toBe('on_device_only');
	});

	it('never runs a done or a cancelled item', () => {
		expect(runnability(item({ state: 'done' }), NOW).reason).toBe('done');
		expect(runnability(item({ state: 'cancelled' }), NOW).reason).toBe('cancelled');
	});

	it('is strictly serial on a slow link', () => {
		const five = [1, 2, 3, 4, 5].map((n) => item({ id: `i${n}`, createdAt: NOW - n }));
		expect(selectRunnable(five, NOW, 'slow')).toHaveLength(1);
	});

	it('runs two at once on a medium link and three on a fast one', () => {
		const five = [1, 2, 3, 4, 5].map((n) => item({ id: `i${n}`, createdAt: NOW - n }));
		expect(selectRunnable(five, NOW, 'medium')).toHaveLength(2);
		expect(selectRunnable(five, NOW, 'fast')).toHaveLength(3);
	});

	it('puts a pending derivative ahead of a vault upload', () => {
		const vault = item({ id: 'vault', createdAt: NOW - 9999 });
		const pub = item({
			id: 'pub',
			createdAt: NOW,
			derivative: { sha256: 'd'.repeat(64), size: 1, mime: 'image/webp', uploaded: false }
		});
		expect(selectRunnable([vault, pub], NOW, 'slow')[0]?.id).toBe('pub');
	});

	it('orders equal-phase items oldest first', () => {
		const newer = item({ id: 'newer', createdAt: NOW - 10 });
		const older = item({ id: 'older', createdAt: NOW - 1000 });
		expect(selectRunnable([newer, older], NOW, 'slow')[0]?.id).toBe('older');
	});

	it('leaves out every item it may not touch', () => {
		const mixed = [
			item({ id: 'ok' }),
			item({ id: 'no-receipt', incidentReceipt: undefined }),
			item({ id: 'waiting', nextEarliestRetry: NOW + 5000 }),
			item({ id: 'done', state: 'done' })
		];
		expect(selectRunnable(mixed, NOW, 'fast').map((i) => i.id)).toEqual(['ok']);
	});
});

describe('the retry schedule', () => {
	it('sets the next retry inside the full-jitter window', () => {
		expect(nextRetryAt(3, NOW, () => 0.999)).toBeLessThan(NOW + 8000);
		expect(nextRetryAt(3, NOW, () => 0)).toBe(NOW);
	});

	it('never schedules further out than the ceiling', () => {
		expect(nextRetryAt(30, NOW, () => 0.999)).toBeLessThan(NOW + MAX_RETRY_DELAY_MS);
	});

	it('spreads the start of a flush so a send is not tied to opening the app', () => {
		expect(flushJitterMs(() => 0.999)).toBeLessThan(FLUSH_JITTER_MS);
		expect(flushJitterMs(() => 0)).toBe(0);
	});
});

describe('link class for uploads', () => {
	it('maps 3g to medium, not fast', () => {
		expect(uploadLinkFrom({ effectiveType: '3g' })).toBe('medium');
		expect(concurrencyFor(uploadLinkFrom({ effectiveType: '3g' }))).toBe(2);
	});

	it('treats save-data as slow whatever the reported type', () => {
		expect(uploadLinkFrom({ effectiveType: '4g', saveData: true })).toBe('slow');
	});

	it('defaults an unknown or absent connection to slow', () => {
		expect(uploadLinkFrom(null)).toBe('slow');
		expect(uploadLinkFrom(undefined)).toBe('slow');
		expect(uploadLinkFrom({})).toBe('slow');
		expect(uploadLinkFrom({ effectiveType: '5g' })).toBe('slow');
	});

	it('never exceeds the concurrency section 19 allows for a tier', () => {
		const ceiling: Record<string, number> = {
			'slow-2g': 1,
			'2g': 1,
			'3g': 2,
			'4g': 3
		};
		for (const [effectiveType, max] of Object.entries(ceiling)) {
			expect(concurrencyFor(uploadLinkFrom({ effectiveType }))).toBeLessThanOrEqual(max);
		}
	});
});

describe('the complete-step status map', () => {
	it('treats a 429 on complete as retryable, so the multipart is not restarted', () => {
		expect(completeStatusOutcome(429)).toBe('retryable');
	});

	it('treats a 502 on complete as retryable', () => {
		expect(completeStatusOutcome(502)).toBe('retryable');
	});

	it('says the upload is really gone only on a 404 or a 409', () => {
		expect(completeStatusOutcome(404)).toBe('no_such_upload');
		expect(completeStatusOutcome(409)).toBe('no_such_upload');
	});

	it('treats a 400 as a local bug, not a reason to retry', () => {
		expect(completeStatusOutcome(400)).toBe('invalid_part');
	});

	it('accepts every 2xx', () => {
		expect(completeStatusOutcome(200)).toBe('ok');
		expect(completeStatusOutcome(204)).toBe('ok');
	});
});

describe('progress copy', () => {
	it('asks for the person when there is no receipt yet', () => {
		expect(progressFor(item({ incidentReceipt: undefined, state: 'queued' }), NOW).key).toBe(
			'outbox_needs_you'
		);
	});

	it('reports the public copy sent once the derivative is uploaded', () => {
		expect(progressFor(item({ state: 'derivative_sent' }), NOW).key).toBe(
			'outbox_step_derivative'
		);
	});

	it('counts only the parts whose ETag is persisted, and never over the total', () => {
		const uploading = item({
			state: 'uploading',
			originalStatus: 'vaulting',
			original: {
				sha256: 'o'.repeat(64),
				size: PART * 3,
				mime: 'image/jpeg',
				r2: {
					bucket: 'harborage-evidence-vault',
					key: 'k',
					uploadId: 'u',
					partSize: PART,
					parts: [
						{ n: 1, etag: 'e1' },
						{ n: 2, etag: 'e2' }
					],
					nextPart: 3
				}
			}
		});
		expect(vaultedBytes(uploading)).toBe(PART * 2);
		const view = progressFor(uploading, NOW);
		expect(view.key).toBe('outbox_step_vaulting');
		expect(view.sentMb).toBe(formatMb(PART * 2));
		expect(Number(view.sentMb)).toBeLessThanOrEqual(Number(view.totalMb));
	});

	it('never claims the original is in the vault before complete is confirmed', () => {
		const completing = item({ state: 'completing', originalStatus: 'vaulting' });
		expect(progressFor(completing, NOW).key).not.toBe('outbox_step_vaulted');
		expect(progressFor(completing, NOW).key).toBe('outbox_step_vaulting');
	});

	it('says the original is in the vault only once the status says so', () => {
		expect(progressFor(item({ state: 'done', originalStatus: 'vaulted' }), NOW).key).toBe(
			'outbox_step_vaulted'
		);
	});

	it('carries the custody status on every view, so a screen cannot omit it', () => {
		for (const state of ['queued', 'registered', 'uploading', 'completing', 'done'] as const) {
			expect(progressFor(item({ state }), NOW).custody).toBeDefined();
		}
	});
});

describe('storage at enqueue', () => {
	it('warns when persistence was refused', () => {
		expect(evaluateStorage({ persisted: false, usage: 0, quota: 1e12, need: 1000 })).toBe(
			'not_persisted'
		);
	});

	it('reports insufficient when the free space is under the sealed original', () => {
		expect(evaluateStorage({ persisted: true, usage: 900, quota: 1000, need: 500 })).toBe(
			'insufficient'
		);
	});

	it('warns rather than blocks when the browser reports no estimate', () => {
		expect(evaluateStorage({ persisted: true, need: 1000 })).toBe('unknown');
	});

	it('stays quiet when persistence is granted and space is ample', () => {
		expect(evaluateStorage({ persisted: true, usage: 0, quota: 1e12, need: 1000 })).toBe('ok');
	});

	it('never blocks a capture, whatever the verdict', () => {
		for (const v of ['ok', 'unknown', 'not_persisted', 'tight', 'insufficient'] as const) {
			expect(storageBlocks(v)).toBe(false);
		}
	});
});

describe('a missing sealed original', () => {
	it('is lost when the queue row outlives the document', () => {
		expect(backingBytesMissing({ originalStatus: 'vaulting' }, undefined)).toBe(true);
	});

	it('is lost when the document survives but its sealed bytes were evicted', () => {
		expect(
			backingBytesMissing({ originalStatus: 'on_device_only' }, { original: { sealed: { size: 0 } } })
		).toBe(true);
	});

	it('is not lost once the vault confirmed it', () => {
		expect(backingBytesMissing({ originalStatus: 'vaulted' }, undefined)).toBe(false);
	});

	it('is not lost for a note that never had an original', () => {
		expect(backingBytesMissing({ originalStatus: 'none' }, undefined)).toBe(false);
	});

	it('is not lost while the bytes are still here', () => {
		expect(
			backingBytesMissing({ originalStatus: 'vaulting' }, { original: { sealed: { size: 42 } } })
		).toBe(false);
	});
});
