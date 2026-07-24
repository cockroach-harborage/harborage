/**
 * FROZEN CRYPTO MODULE (ARCHITECTURE §5).
 *
 * All cryptography in Harborage lives here and nowhere else. This package is
 * CODEOWNERS-frozen: changes require maintainer review on the sensitive path,
 * and a paid external audit is a hard switch-on gate for evidence and brokered
 * features. Do not add crypto elsewhere; do not "improve" primitives here as a
 * side effect of a feature change.
 *
 * Contents: BIP39 identity (§5.1–5.2), the HKDF compartment tree (§5.1),
 * XChaCha20-Poly1305 sealing (§5.4 client-side), minisign verification (§5.6),
 * Shamir secret sharing (§5.4). libsodium (sealed-box, secretstream) is
 * lazy-loaded via ./sodium only behind vault/broker features — never on first paint.
 */
export * from './mnemonic.ts';
export * from './hkdf-tree.ts';
export * from './seal.ts';
export * from './minisign.ts';
export * from './pack.ts';
export * from './notice.ts';
export * from './shamir.ts';
