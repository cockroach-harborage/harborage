// Canonical JSON serialization for signed content packs (ARCHITECTURE §5.6).
// Deterministic by construction: object keys sorted, arrays order-preserved,
// compact (no insignificant whitespace). The SAME algorithm runs in the on-device
// verifier (packages/crypto/src/pack.ts canonicalJson) so a manifest hash computed
// here matches one recomputed on-device. If you change this, change both, or
// every pack signature and manifest hash silently breaks. verify-pack.mjs and the
// crypto pack test both assert the same known-answer vector to guard agreement.
import { createHash } from 'node:crypto';

export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
	const keys = Object.keys(value).sort();
	return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function sha256Hex(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}
