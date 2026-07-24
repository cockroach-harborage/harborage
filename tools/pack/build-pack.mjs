#!/usr/bin/env node
// Build the signed knowledge packs (ARCHITECTURE §5.6, §12 M1).
//
// Deterministic: sorted keys, no timestamps, no locale-dependent formatting, so
// the same sources always produce byte-identical pack files. That is what lets
// CI verify the committed pack against source without a fragile rebuild-and-diff
// across machines, and what lets the offline signer sign a stable artifact.
//
// Signing is NOT done here — the offline m-of-n project key signs the emitted
// `.harborage-pack` out of band and the detached `.minisig` is committed
// separately. This script only assembles the bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { PACKS, packFilename } from './packs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(repoRoot, 'apps/web/static/packs');

/** Assemble one pack object from its member source files (pure, deterministic). */
export function assemblePack(pack) {
	const manifest = {};
	const files = {};
	for (const m of pack.members) {
		const raw = readFileSync(join(repoRoot, m.source), 'utf8');
		const content = JSON.parse(raw); // parse then re-serialize canonically
		const canonical = canonicalJson(content);
		manifest[m.path] = sha256Hex(canonical);
		files[m.path] = content;
	}
	return { format: 'harborage-pack/v1', name: pack.name, epoch: pack.epoch, manifest, files };
}

/** The exact bytes written to disk and signed offline. */
export function packBytes(pack) {
	return canonicalJson(assemblePack(pack));
}

function main() {
	mkdirSync(outDir, { recursive: true });
	for (const pack of PACKS) {
		const bytes = packBytes(pack);
		const out = join(outDir, packFilename(pack));
		writeFileSync(out, bytes);
		console.log(
			`built ${packFilename(pack)} (${bytes.length} bytes, ${pack.members.length} file(s))`
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
