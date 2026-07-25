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
// 4. The source-import handler contains no outbound fetch, and the archive
//    master handler never names the vault bucket.
//
// Rules 4 exist as GATES rather than unit tests on purpose. Both routes sit
// behind a per-request credential, so a Workers unit test without a valid
// cap-cert gets 401 and never reaches the code it means to check -- I wrote
// both as behaviour tests first, sabotaged them, and watched them stay green.
// A static check has no such blind spot: it refuses the code's existence rather
// than its reachability.
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

// Rule 4a: the import handler must make no outbound request. Re-hosting
// someone else's media is counsel-gated, and the off-platform egress that would
// make it safe to attempt does not exist.
// Rule 4b: the master handler must never name the vault bucket.
const HANDLERS = [
	{
		file: 'workers/api/src/app.ts',
		start: "app.post('/api/archive/import'",
		banned: [{ re: /\bfetch\s*\(/, why: 'makes an outbound request; source import is fingerprint-and-reference only (§16)' }]
	},
	{
		file: 'workers/media/src/app.ts',
		start: "app.post('/media/master'",
		banned: [
			{ re: /EVIDENCE_VAULT_BUCKET/, why: 'names the vault bucket; the master path reads and writes public media only (§16)' },
			{ re: /IMAGES\s*\.\s*hosted/, why: 'uses the hosted Images namespace, which needs a paid plan and is not part of this design' }
		]
	}
];

for (const h of HANDLERS) {
	const abs = join(repoRoot, h.file);
	let text;
	try {
		text = read(abs);
	} catch {
		// The fixture trees do not all carry these files; absence is not a failure.
		continue;
	}
	const from = text.indexOf(h.start);
	if (from < 0) continue;
	// The handler ends at the next top-level `app.` registration.
	const after = text.indexOf('\napp.', from + 1);
	const body = text.slice(from, after < 0 ? text.length : after);
	for (const rule of h.banned) {
		if (rule.re.test(body)) {
			problems.push(`${h.file} — the ${h.start.split("'")[1]} handler ${rule.why}`);
		}
	}
}

if (fail('gate-archive-custody', problems)) process.exit(1);
console.log(
	`gate-archive-custody OK: ${migrations} migration(s), ${queries} query/-ies, no vault fingerprint, no unremovable custody, no oracle join`
);
