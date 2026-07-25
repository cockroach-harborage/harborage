// Evidence-archive custody invariants (ARCHITECTURE §16; CLAUDE.md "Evidence
// Archive standards").
//
// Three properties that are cheap to state and expensive to notice the loss of.
// Each is enforced by ABSENCE in the schema rather than by a rule in a Worker,
// because a rule can be edited by someone who does not know why it is there.
//
// 1. No fingerprint of a SEALED original may exist in plaintext D1. A plaintext
//    fingerprint of unreadable content is a content-existence oracle: anyone
//    holding a copy of an original could test whether we hold it, over content
//    we describe as unreadable. §16 confines the dedup index to the PUBLIC
//    derivative set for exactly this reason.
// 2. No column may express custody nobody can undo. §16 chooses purgeability
//    over deletion-resistance: a multi-party logged purge override has to
//    supersede every durability mechanism for illegal content or a lawful
//    erasure order, and durability applied before certainty turns a detection
//    miss into content that can never be taken down. "Permanent from day zero"
//    and "we can always purge" are mutually exclusive, and this is the choice.
// 3. No query may join the public fingerprint index to the vault keyring table.
//    Separately both are fine; together they are the oracle rule 1 removes.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

// A fingerprint column whose name ties it to a vault/sealed/original object.
// Matched in either order, since both readings appear in real schemas.
const VAULT_FINGERPRINT_RE =
	/\b((vault|sealed|original)_?\w*_?(phash|dhash|perceptual|fingerprint)|(phash|dhash|perceptual|fingerprint)_?\w*_?(of_)?(vault|sealed|original))\b/i;

// Words that can only mean "this cannot be removed". Checked across the whole
// file including comments, like gate-schema: describing the column is as good
// as having it, because the next person implements what the comment describes.
const PERMANENT_CUSTODY_RE =
	/\b(retain_until|retention_until|lock_until|locked_until|bucket_lock|object_lock|legal_hold|worm_|immutable)\b/i;

const problems = [];

let migrations = 0;
for (const file of walk(join(repoRoot, 'migrations'))) {
	if (!file.endsWith('.sql')) continue;
	migrations++;
	const rel = relative(repoRoot, file);
	const text = read(file);

	const fingerprint = text.match(VAULT_FINGERPRINT_RE);
	if (fingerprint) {
		problems.push(
			`${rel} — ${JSON.stringify(fingerprint[0])} fingerprints a sealed original in plaintext D1; that is a content-existence oracle (§16)`
		);
	}

	const permanent = text.match(PERMANENT_CUSTODY_RE);
	if (permanent) {
		problems.push(
			`${rel} — ${JSON.stringify(permanent[0])} expresses custody that cannot be undone; §16 chooses purgeability over deletion-resistance`
		);
	}

	// The public fingerprint table must not learn anything about originals.
	const phashTable = text.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?perceptual_hashes\s*\(([\s\S]*?)\);/i);
	if (phashTable) {
		const body = phashTable[1];
		for (const banned of ['original_sha256', 'vault_key', 'vault_object', 'sealed_sha256']) {
			if (new RegExp(`\\b${banned}\\b`, 'i').test(body)) {
				problems.push(
					`${rel} — perceptual_hashes names ${JSON.stringify(banned)}; it fingerprints PUBLIC derivatives only (§16)`
				);
			}
		}
	}
}

// The oracle can also be assembled at query time from two innocent tables.
let queries = 0;
for (const top of ['workers', 'apps']) {
	for (const file of walk(join(repoRoot, top))) {
		if (!/\.(ts|js)$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
		const text = read(file);
		for (const m of text.matchAll(/\.(?:prepare|exec)\s*\(\s*(['"`])([\s\S]*?)\1/g)) {
			const sql = m[2];
			if (!/select|insert|update|delete/i.test(sql)) continue;
			queries++;
			if (/perceptual_hashes/i.test(sql) && /evidence_keyrings|vault_key/i.test(sql)) {
				problems.push(
					`${relative(repoRoot, file)} — a query joins the public fingerprint index to vault key custody; separately fine, together the existence oracle (§16)`
				);
			}
		}
	}
}

if (fail('gate-archive-custody', problems)) process.exit(1);
console.log(
	`gate-archive-custody OK: ${migrations} migration(s), ${queries} query/-ies, no vault fingerprint, no unremovable custody, no oracle join`
);
