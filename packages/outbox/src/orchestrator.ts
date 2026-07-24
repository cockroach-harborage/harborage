/**
 * Three-phase outbox priority ladder (design review; ARCHITECTURE §7.6, §19).
 *
 * MultipartUploader alone does not enforce phase order — it will start the vault
 * multipart from `queued`. This orchestrator guarantees a later phase never
 * steals bandwidth from an earlier one, and persists after each phase so a
 * kill/resume continues where it left off:
 *
 *   1. register   — POST the tiny sealed metadata + hashes to the api Worker
 *                   (always first, always sent).
 *   2. derivative — single presigned PUT of the redacted derivative to
 *                   public-media (small; may `skip` on viral-repost dedup).
 *   3. vault      — sealed original to evidence-vault via resumable multipart
 *                   (large, opportunistic, spans sessions).
 *
 * Pure logic with injected ports; the browser wires network/bytes adapters.
 */
import type { CipherSource, OutboxItem, OutboxStore } from './types.ts';

/** Phase 1: register the sealed incident metadata; returns an opaque receipt. */
export interface RegisterPort {
	register(item: OutboxItem): Promise<string>;
}

/** Phase 2: upload the redacted derivative direct to public-media (or skip). */
export interface DerivativePort {
	uploadDerivative(item: OutboxItem): Promise<void>;
}

/** Provides the sealed, part-aligned ciphertext for the vault original. */
export interface CipherProvider {
	getCipher(item: OutboxItem): Promise<CipherSource>;
}

/** Phase 3 driver — MultipartUploader satisfies this structurally. */
export interface StepRunner {
	step(item: OutboxItem, cipher: CipherSource): Promise<{ item: OutboxItem }>;
}

export class OutboxOrchestrator {
	constructor(
		private readonly store: OutboxStore,
		private readonly register: RegisterPort,
		private readonly derivative: DerivativePort,
		private readonly uploader: StepRunner,
		private readonly cipher: CipherProvider
	) {}

	/**
	 * Advance one item as far as the link allows this session, strictly in phase
	 * order. Safe to call repeatedly (foreground-flush): each guard is idempotent.
	 */
	async advance(item: OutboxItem): Promise<OutboxItem> {
		if (item.state === 'done' || item.state === 'cancelled') return item;

		// Phase 1 — register (always first). The receipt gates everything after.
		if (!item.incidentReceipt) {
			item.incidentReceipt = await this.register.register(item);
			if (item.state === 'queued') item.state = 'registered';
			await this.store.put(item);
		}

		// Phase 2 — redacted derivative. Never before register.
		if (!item.derivative.uploaded) {
			await this.derivative.uploadDerivative(item);
			item.derivative.uploaded = true;
			if (item.state === 'registered') item.state = 'derivative_sent';
			await this.store.put(item);
		}

		// Phase 3 — sealed original (resumable). Never before phases 1 and 2.
		const cipher = await this.cipher.getCipher(item);
		const result = await this.uploader.step(item, cipher);
		return result.item;
	}
}
