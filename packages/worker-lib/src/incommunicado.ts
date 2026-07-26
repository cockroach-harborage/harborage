/**
 * The incommunicado trigger predicate (ARCHITECTURE §8.3; PRD §4.11).
 *
 * WHAT AN INCOMMUNICADO ALERT IS. Somebody was detained and has not been produced
 * or allowed contact. Firing one mobilises lawyers and attention. Firing a FALSE
 * one is not a harmless mistake: it is how a provocateur wastes the response
 * capacity of the people who would otherwise be helping someone real, and how a
 * hostile actor learns which refs this platform is tracking by watching what moves.
 *
 * SO THE BAR IS DELIBERATELY UNSATISFIABLE TODAY, TWICE OVER:
 *
 *   1. TWO INDEPENDENT AUTHENTICATED TRIGGERS from two DISTINCT legal-compartment
 *      keys, over the identical `ref_hash ‖ trigger_epoch`, arriving on
 *      SEPARATELY-TICKED requests. Two signatures in one request body is one
 *      person with two keys; two requests separated in time is a second person, or
 *      at least a second deliberate act by the same one.
 *   2. A `legal_broker` role signature from key_directory, which ships EMPTY.
 *
 * Neither can be satisfied by code. (1) needs two lawyers; (2) needs an offline
 * key ceremony.
 *
 * HONEST LIMIT, and it belongs in the copy as well as here: a state that can compel
 * two lawyer devices can fire this. The defence against a provocateur is the rate
 * limit and the human broker, NOT cryptography. Nothing in this file makes the
 * alert unforgeable by an adversary who holds the keys.
 *
 * Pure. The rate limit and the queue emit live in the route; this module only
 * decides whether the bar is met.
 */
import { domainSeparate, SIG_CONTEXT } from '@harborage/crypto/compartments';
import { verify } from '@harborage/crypto/hkdf-tree';
import type { KeyDirectoryEntry, RevocationEntry } from '@harborage/crypto/notice';
import { verifyRoleQuorum, type RoleSignature } from '@harborage/crypto/quorum';

/** Distinct legal-compartment keys that must each have triggered. */
export const TRIGGERS_REQUIRED = 2;

/**
 * How far apart two triggers must be to count as separate.
 *
 * Not a nicety. Two requests inside one tick are one action with two signatures
 * attached, which is exactly the "one person holding two keys" case the two-trigger
 * rule exists to exclude. One minute is short enough not to obstruct a genuine
 * second lawyer and long enough that firing both from one script is a deliberate,
 * timed act rather than a loop.
 */
export const TRIGGER_TICK_MS = 60_000;

/**
 * How long a trigger stays countable.
 *
 * A trigger from six hours ago is not evidence that somebody is being held NOW.
 * Bounded so the two triggers describe the same situation.
 */
export const TRIGGER_WINDOW_MS = 2 * 60 * 60_000;

/** Minimum eligible legal_broker keys in the directory. The n of m-of-n. */
export const BROKER_MIN_KEYS = 3;
/** Broker signatures required. */
export const BROKER_REQUIRED = 1;

export interface Trigger {
	/** Which legal-compartment key acted. Opaque; never a lawyer's identity. */
	keyIdHex: string;
	/** Base64 Ed25519 public key for that trigger. */
	publicKeyB64: string;
	/** Base64 signature over domainSeparate(legalTrigger, refHash ‖ epoch). */
	sigB64: string;
	/** Coarse tick this trigger arrived on, not a timestamp. */
	tick: number;
}

export type TriggerFailure =
	| 'not-enough-triggers'
	| 'same-key'
	| 'same-tick'
	| 'stale-trigger'
	| 'bad-signature'
	| 'no-broker-quorum';

export interface TriggerVerdict {
	fire: boolean;
	reason?: TriggerFailure;
}

export function tickOf(nowMs: number): number {
	return Math.floor(nowMs / TRIGGER_TICK_MS);
}

function unb64(s: string): Uint8Array | null {
	try {
		const bin = atob(s);
		return Uint8Array.from(bin, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/** The bytes a legal-compartment key signs: the ref bound to its epoch. */
export function triggerMessage(refHash: string, triggerEpoch: number): Uint8Array {
	return new TextEncoder().encode(`${refHash}:${triggerEpoch}`);
}

/**
 * Does this set of triggers clear the bar?
 *
 * FAILS CLOSED ON EVERY PATH, and returns one reason so an operator surface can say
 * which half is missing without telling a caller anything it did not already know.
 */
export function shouldFire(input: {
	refHash: string;
	triggerEpoch: number;
	triggers: readonly Trigger[];
	brokerSignatures: readonly RoleSignature[];
	brokerMessageHash: Uint8Array;
	directory: readonly KeyDirectoryEntry[];
	revocations: readonly RevocationEntry[];
	nowMs: number;
}): TriggerVerdict {
	const message = triggerMessage(input.refHash, input.triggerEpoch);
	const nowTick = tickOf(input.nowMs);
	const windowTicks = Math.ceil(TRIGGER_WINDOW_MS / TRIGGER_TICK_MS);

	const valid: Trigger[] = [];
	for (const t of input.triggers) {
		// Stale first: an old trigger is not evidence anyone is being held now.
		if (!Number.isInteger(t.tick) || nowTick - t.tick > windowTicks || t.tick > nowTick) continue;
		const pub = unb64(t.publicKeyB64);
		const sig = unb64(t.sigB64);
		if (pub === null || sig === null) continue;
		if (!verify(SIG_CONTEXT.legalTrigger, sig, message, pub)) continue;
		valid.push(t);
	}

	if (valid.length < TRIGGERS_REQUIRED)
		return { fire: false, reason: valid.length === 0 ? 'bad-signature' : 'not-enough-triggers' };

	// TWO DISTINCT KEYS. Deduplicated on the key, not the signature: Ed25519 is
	// deterministic, but a caller could still present two encodings of one signature
	// and a signature-keyed set would count them twice.
	const keys = new Set(valid.map((t) => t.keyIdHex));
	if (keys.size < TRIGGERS_REQUIRED) return { fire: false, reason: 'same-key' };

	// SEPARATELY TICKED. Two requests inside one tick are one action with two
	// signatures attached, which is the case this rule exists to exclude.
	const ticks = new Set(valid.map((t) => t.tick));
	if (ticks.size < TRIGGERS_REQUIRED) return { fire: false, reason: 'same-tick' };

	// The oldest countable trigger must still be inside the window relative to the
	// newest, so the two describe the same situation rather than two separate ones.
	const spread = Math.max(...ticks) - Math.min(...ticks);
	if (spread > windowTicks) return { fire: false, reason: 'stale-trigger' };

	// THE SECOND, INDEPENDENT BAR. key_directory ships empty, so this refuses today
	// however many lawyers act.
	const quorum = verifyRoleQuorum({
		contextTag: SIG_CONTEXT.legalBroker,
		messageHash: input.brokerMessageHash,
		signatures: input.brokerSignatures,
		directory: input.directory,
		revocations: input.revocations,
		requiredRole: 'legal_broker',
		required: BROKER_REQUIRED,
		minDistinctKeys: BROKER_MIN_KEYS,
		epoch: input.triggerEpoch
	});
	if (!quorum.valid) return { fire: false, reason: 'no-broker-quorum' };

	return { fire: true };
}

/**
 * What goes on the life-safety queue when the bar IS met.
 *
 * TWO FIELDS. No lawyer, no detainee, no station, no region, no charge, no time.
 * Queue messages are retained for days and a DLQ holds them longer, so
 * "incommunicado in IN-PB-LDH at 14:05" sitting in a dead-letter queue is a
 * protest-intensity signal tied to a place and an hour.
 */
export interface IncommunicadoEvent {
	kind: 'incommunicado';
	ref_hash: string;
}

export function incommunicadoEvent(refHash: string): IncommunicadoEvent {
	return { kind: 'incommunicado', ref_hash: refHash };
}
