/**
 * Generalised role-key quorum verification (ARCHITECTURE §5.5, §6.3, §8.2).
 *
 * VERIFY ONLY. There is no Ed25519 signing function anywhere in this package,
 * deliberately: a signing key reachable from an edge Worker is a key a compelled
 * edge can use. Signing is an offline hardware-token ceremony.
 *
 * WHY THIS EXISTS ALONGSIDE verifyNotice(), rather than as a rename of it. Two
 * gaps in the notice verifier are load-bearing for M5 and were fixed here rather
 * than by loosening anything:
 *
 * 1. NO n FLOOR. verifyNotice counts distinct signers and compares against m.
 *    §8.2's bar is "at least 2 of at least 3 DISTINCT reviewer role keys", and
 *    the second half is not expressible with a single m: a directory holding
 *    exactly two reviewer keys satisfies 2-of-2 while satisfying nothing about
 *    the "of at least 3". For notices m = 3 of 3 is still three humans, so it is
 *    a gap only for the naming gate and the marshal quorum, which is precisely
 *    what M5 adds. `minDistinctKeys` closes it.
 *
 * 2. NO DOMAIN SEPARATION. verifyNotice verifies over the bare 32-byte payload
 *    hash. A captured notice signature over hash H is then, byte for byte, a
 *    valid signature over the same H in any other protocol that also signs a
 *    bare hash. Today only role binding stops a marshal signature being replayed
 *    as a naming signature, and role binding is a POLICY invariant, not a
 *    cryptographic one. Every signature this function checks is framed through
 *    domainSeparate(), so a signature made for one context cannot be presented
 *    as another. The repo already had the primitive; it was simply not used here.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { domainSeparate, type SigContext } from './compartments.ts';
import type { KeyDirectoryEntry, RevocationEntry } from './notice.ts';

export interface RoleSignature {
	key_id: string;
	/** base64 Ed25519 signature over domainSeparate(contextTag, messageHash). */
	sig: string;
}

export interface QuorumPolicy {
	/** The protocol this signature was made for. Framed into the signed bytes. */
	contextTag: SigContext;
	/** What was signed: a canonical record hash, never a mutable object. */
	messageHash: Uint8Array;
	signatures: readonly RoleSignature[];
	directory: readonly KeyDirectoryEntry[];
	revocations: readonly RevocationEntry[];
	/** Only keys bound to this role count. */
	requiredRole: string;
	/** m: distinct valid signatures needed. */
	required: number;
	/** n: the directory must hold at least this many eligible keys. */
	minDistinctKeys: number;
	/** Epoch the record belongs to, checked against each key's validity window. */
	epoch: number;
}

export interface QuorumResult {
	valid: boolean;
	validSigners: string[];
	required: number;
	/** Present only on failure. Never surfaced to an untrusted caller. */
	reason?: string;
}

/**
 * Does this bundle meet m-of-n?
 *
 * Fails closed on every path. The directory ships empty until the offline
 * ceremony, so today every call returns false and no marshal signal or naming
 * record can be presented as authentic.
 */
export function verifyRoleQuorum(policy: QuorumPolicy): QuorumResult {
	const { required } = policy;
	const fail = (reason: string): QuorumResult => ({
		valid: false,
		validSigners: [],
		required,
		reason
	});

	const revoked = new Set(policy.revocations.map((r) => r.key_id));

	// Eligible = in the directory, bound to this role, not revoked, valid at this
	// epoch. The n floor counts ELIGIBLE keys, not directory rows: a directory of
	// fifty keys of which two are marshals is a two-marshal directory.
	const eligible = policy.directory.filter(
		(e) =>
			e.role === policy.requiredRole &&
			!revoked.has(e.key_id) &&
			policy.epoch >= e.valid_from_epoch &&
			(e.valid_to_epoch === null || policy.epoch <= e.valid_to_epoch)
	);
	if (eligible.length < policy.minDistinctKeys)
		return fail(
			`directory holds ${eligible.length} eligible ${policy.requiredRole} key(s); at least ${policy.minDistinctKeys} are required, so ${required}-of-${policy.minDistinctKeys} is not satisfiable`
		);

	const byId = new Map(eligible.map((e) => [e.key_id, e]));
	// A Set, so the same key signing twice counts once. Two signatures from one
	// key is one key, and one key is one seized device.
	const validSigners = new Set<string>();
	const framed = domainSeparate(policy.contextTag, policy.messageHash);

	for (const s of policy.signatures) {
		const entry = byId.get(s.key_id);
		if (!entry) continue;
		try {
			if (ed25519.verify(base64.decode(s.sig), framed, base64.decode(entry.public_key)))
				validSigners.add(s.key_id);
		} catch {
			// Malformed signature or key: skip this signer, never throw.
		}
	}

	if (validSigners.size < required)
		return fail(`${validSigners.size} valid signature(s); ${required} required`);

	return { valid: true, validSigners: [...validSigners], required };
}
