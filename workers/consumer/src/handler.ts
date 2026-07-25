/**
 * Queue message handling (ARCHITECTURE §15, §18.3). Kept out of index.ts so it
 * imports no Workers-only module and can be driven in plain Node.
 *
 * THE ACK RULE, which is the whole reason this file is careful:
 *
 *   Cloudflare Queues acks an ENTIRE BATCH on a bare return. A handler that
 *   falls off the end, or throws past a `try`, silently marks every message in
 *   that batch as delivered. Here a message is a protestor's report of
 *   something that happened to them, so a silent ack is that report ceasing to
 *   exist — no error, no trace, no way to know it was lost.
 *
 * So every path ends in an explicit ack() or retry() on the INDIVIDUAL message,
 * and one bad message never decides the fate of its neighbours.
 *
 * The retry/ack choice is deliberate per failure kind:
 *   - config not ready (no intake key)  -> retry, it is transient
 *   - body will never open (poison)     -> retry, so it reaches the DLQ and is
 *                                          preserved for inspection rather than
 *                                          silently dropped
 *   - storage failed                    -> retry
 *   - handled                           -> ack
 * Nothing is ever ack'ed merely because it was inconvenient.
 */
import { openSealedBox } from '@harborage/crypto/sealed-box';
import { ALG_VAULT_KEYRING, unframeEnvelope } from '@harborage/worker-lib/envelope';
import { decodeKeyring } from '@harborage/crypto/vault-key';
import { safeLog } from '@harborage/worker-lib/safe-log';
import type { Observations } from '@harborage/worker-lib/verification';
import { compileRuleset, loadRuleset, screen, type CompiledRuleset } from './tier0.ts';

export interface QueueMessageLike<T = unknown> {
	readonly body: T;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatchLike<T = unknown> {
	readonly messages: readonly QueueMessageLike<T>[];
}

export interface RegisterBody {
	kind?: unknown;
	envelope?: unknown;
}

/** What the consumer needs. A narrow shape so tests need no Workers runtime. */
export interface HandlerDeps {
	rulesets: { get(key: string, options?: { type?: 'json'; cacheTtl?: number }): Promise<unknown> };
	intakePrivateKey: string | undefined;
	/** Persist an admitted incident. Throws to signal a retryable failure. */
	recordIncident(input: RecordedIncident): Promise<void>;
	/** Persist an opaque evidence keyring. Throws to signal a retryable failure. */
	recordKeyring(input: RecordedKeyring): Promise<void>;
	/** Hand the observations to the per-item state machine. */
	applyVerification(itemId: string, observations: Observations): Promise<void>;
	/** Injected so the handler stays free of a clock. */
	now(): number;
}

export interface RecordedIncident {
	id: string;
	type: string;
	occurredDate: string | null;
	regionBucket: string;
	narrative: string;
	isDirective: boolean;
	originalSha256: string | null;
	derivativeSha256: string | null;
	redactionConfirmed: boolean;
}

/**
 * An evidence keyring, as the platform is allowed to know it.
 *
 * `keyring` is opaque ciphertext. There is deliberately no field for anything
 * inside it, and no code path here opens it: the consumer holds
 * INTAKE_PRIVATE_KEY, which opens the incident metadata envelope and NOTHING
 * else. gate-sealed-body records that scoping as a distinct sealed object, and
 * this shape is what makes it true rather than merely claimed.
 */
export interface RecordedKeyring {
	originalSha256: string;
	tier: 'A' | 'B';
	keyring: Uint8Array;
	copyCount: number;
	createdBucket: string;
}

export type Disposition = 'ack' | 'retry';

export interface Outcome {
	disposition: Disposition;
	/** A stable code, never content. Fed to safeLog as `outcome`. */
	reason: string;
}

function unhex(s: string): Uint8Array | null {
	if (!/^[0-9a-f]{64}$/.test(s)) return null;
	const out = new Uint8Array(32);
	for (let i = 0; i < 32; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function asBytes(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	// Queues round-trips structured data; an array of byte values is what a
	// Uint8Array can arrive as after serialisation.
	if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
		return Uint8Array.from(value as number[]);
	}
	return null;
}

/** Coarse day bucket. A precise instant would be a per-report record of when. */
function dayBucket(nowMs: number): string {
	return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Handle one register message. Returns the disposition rather than acking, so
 * the caller owns the ack and the tests can assert what would have happened.
 */
export async function handleRegister(
	body: RegisterBody,
	rules: CompiledRuleset,
	deps: HandlerDeps
): Promise<Outcome> {
	if (!deps.intakePrivateKey) {
		// The key is set at intake switch-on. Until then nothing can be read, and
		// dropping the message would lose it.
		return { disposition: 'retry', reason: 'intake_key_absent' };
	}
	const secret = unhex(deps.intakePrivateKey);
	if (!secret) return { disposition: 'retry', reason: 'intake_key_malformed' };

	const framed = asBytes(body.envelope);
	if (!framed) return { disposition: 'retry', reason: 'envelope_missing' };

	const unframed = unframeEnvelope(framed);
	if (!unframed) return { disposition: 'retry', reason: 'envelope_malformed' };

	const plaintext = openSealedBox(secret, unframed.sealed);
	if (!plaintext) {
		// It will never open. Retrying sends it to the DLQ, which preserves it
		// for inspection; acking would discard it silently.
		return { disposition: 'retry', reason: 'envelope_unopenable' };
	}

	let meta: Record<string, unknown>;
	try {
		meta = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
	} catch {
		return { disposition: 'retry', reason: 'metadata_not_json' };
	}

	const narrative = typeof meta.note === 'string' ? meta.note : '';
	const area = typeof meta.area === 'string' ? meta.area : '';
	const verdict = screen(`${narrative}\n${area}`, rules);

	const incident: RecordedIncident = {
		id: crypto.randomUUID(),
		type: typeof meta.type === 'string' ? meta.type : 'other',
		occurredDate: typeof meta.occurred_date === 'string' ? meta.occurred_date : null,
		// Area is a coarse bucket the user typed. There is no coordinate here and
		// never will be: the schema has no column for one.
		regionBucket: area.slice(0, 64),
		narrative,
		isDirective: verdict.isDirective,
		originalSha256: typeof meta.original_sha256 === 'string' ? meta.original_sha256 : null,
		derivativeSha256: typeof meta.derivative_sha256 === 'string' ? meta.derivative_sha256 : null,
		redactionConfirmed: meta.redaction_confirmed === true
	};

	// Tier-0 produces ONE signal however many patterns matched. The machine
	// needs two independent ones before it hides anything, and this stage can
	// never supply the second by matching harder.
	const observations: Observations = {
		tier0Clean: verdict.clean,
		secondIndependentRisk: false,
		aiVerdict: 'unavailable',
		aiConfidenceMilli: 0,
		independentCorroborators: 0,
		independenceBuckets: 0,
		corroborationWeight: 0,
		flagWeight: 0,
		dwellMs: 0,
		cibOpen: false,
		crossCompartmentAnchor: false,
		cohortPivot: false,
		isDirective: verdict.isDirective,
		hardEvidenceDebunk: verdict.knownBadMedia,
		counterClusterPresent: false,
		counterClusterIndependent: false
	};

	try {
		await deps.recordIncident(incident);
		await deps.applyVerification(incident.id, observations);
	} catch {
		return { disposition: 'retry', reason: 'storage_failed' };
	}

	void dayBucket(deps.now());
	return { disposition: 'ack', reason: verdict.clean ? 'recorded' : 'recorded_flagged' };
}

/**
 * Handle a whole batch. Never returns without having explicitly disposed of
 * every message, including when a handler throws.
 */
/**
 * Handle one evidence-keyring message.
 *
 * NOTE WHAT IS ABSENT: no unseal, no openSealedBox, no key. The blob is parsed
 * only far enough to learn its tier, its copy count and which file digest it
 * belongs to -- all of which are in the cleartext header by design -- and is
 * then stored verbatim. If this function could open a keyring, the SEALED-E2E
 * claim on POST /api/evidence/keyring would be false.
 */
export async function handleKeyring(
	body: RegisterBody,
	deps: HandlerDeps
): Promise<Outcome> {
	const framed = asBytes(body.envelope);
	if (!framed) return { disposition: 'retry', reason: 'keyring_missing' };

	const unframed = unframeEnvelope(framed);
	if (!unframed || unframed.algId !== ALG_VAULT_KEYRING)
		return { disposition: 'retry', reason: 'keyring_malformed' };

	const ring = decodeKeyring(unframed.sealed);
	// Malformed goes to the DLQ rather than being acked away: a keyring is the
	// only thing standing between a reporter and their own sealed evidence.
	if (!ring) return { disposition: 'retry', reason: 'keyring_undecodable' };

	try {
		await deps.recordKeyring({
			originalSha256: Array.from(ring.originalSha256, (b) => b.toString(16).padStart(2, '0')).join(
				''
			),
			tier: ring.tier,
			keyring: unframed.sealed,
			copyCount: ring.copies.length,
			createdBucket: dayBucket(deps.now())
		});
	} catch {
		return { disposition: 'retry', reason: 'keyring_store_failed' };
	}
	return { disposition: 'ack', reason: 'keyring_stored' };
}

export async function handleBatch(
	batch: QueueBatchLike<RegisterBody & { kind?: unknown }>,
	deps: HandlerDeps
): Promise<Outcome[]> {
	const rules = compileRuleset(await loadRuleset(deps.rulesets));
	const outcomes: Outcome[] = [];

	for (const message of batch.messages) {
		let outcome: Outcome;
		try {
			const kind = message.body?.kind;
			if (kind === 'incident_register') {
				outcome = await handleRegister(message.body, rules, deps);
			} else if (kind === 'evidence_keyring') {
				outcome = await handleKeyring(message.body, deps);
			} else if (kind === 'directory_report') {
				// route-to-gate only: a report never auto-hides anything. The console
				// queue is the consumer of these, and it lands with slice 7.
				outcome = { disposition: 'ack', reason: 'directory_report_queued' };
			} else {
				// An unknown kind is a bug or a poisoned message. Send it to the DLQ
				// rather than acking it away.
				outcome = { disposition: 'retry', reason: 'unknown_kind' };
			}
		} catch {
			// A throw must never escape into the batch-level implicit ack.
			outcome = { disposition: 'retry', reason: 'handler_threw' };
		}

		if (outcome.disposition === 'ack') message.ack();
		else message.retry();
		outcomes.push(outcome);
		safeLog('queue_message', { queue: 'moderation-bulk', outcome: outcome.reason });
	}

	return outcomes;
}
