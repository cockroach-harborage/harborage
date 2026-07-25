/**
 * gate-naming-gate — the build refuses to weaken red lines 1 and 2.
 *
 * These rules exist because the alternative is a comment. A comment saying "never
 * add a PUBLISHED status here" is read once by the person who wrote it; a gate is
 * read by every commit. The five checks below are each a one-line edit somebody
 * could plausibly make while doing something else, and each of those edits is how
 * an innocent person ends up named.
 *
 * WHAT THIS GATE IS NOT. It does not prove the Review gate is correct — that is
 * the client-side verifier's job, and the client is the guarantee because a
 * compelled Worker can be compelled to skip an `if`. This gate proves the SHAPE:
 * that the unsafe state has no representation, that no runtime read path exists
 * for a LOCKED flag, and that no migration quietly satisfies a quorum.
 */
import { join } from 'node:path';
import { blankComments, fail, read, repoRoot, stripComments, walk } from './lib.mjs';

const GATE = 'gate-naming-gate';
const problems = [];

// ---- Parse forward migrations into { table -> CREATE TABLE body } ------------
// Same shape as gate-d1-index's parser, deliberately: one way to read the schema.
const bodies = new Map();
const migrationsDir = join(repoRoot, 'migrations');
const migrationFiles = [];
for (const file of walk(migrationsDir)) {
	if (!file.endsWith('.sql')) continue;
	if (file.includes(`${'inverse'}/`) || file.includes(`${'inverse'}\\`)) continue;
	migrationFiles.push(file);
	const sql = read(file);
	for (const m of sql.matchAll(
		/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi
	)) {
		bodies.set(m[1].toLowerCase(), { body: m[2], file });
	}
}

// ---- 1. plainclothes_claims has no publishable state, and no identity column -
//
// THE STRONGEST FORM OF A RULE IS ONE WHERE THE UNSAFE STATE CANNOT BE
// REPRESENTED. A flag can be flipped and an `if` can be skipped; a CHECK
// constraint that has never contained 'PUBLISHED' means SQLite itself refuses
// the write, whatever the application code says.
const PLAINCLOTHES = 'plainclothes_claims';
const pc = bodies.get(PLAINCLOTHES);
if (!pc) {
	problems.push(
		`${PLAINCLOTHES} is not declared in any forward migration. If it was renamed, rename it here too: this gate is the only thing keeping red line 2 structural`
	);
} else {
	// The CHECK on status must exist. Without it, any string is a valid status.
	const statusCheck = /status\s+TEXT[^,]*CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i.exec(pc.body);
	if (!statusCheck) {
		problems.push(
			`${PLAINCLOTHES}.status has no CHECK (status IN (...)) constraint, so any status value is writable — including a published one`
		);
	} else {
		// Scanned over the CHECK LIST ONLY, not the whole file, so the prose above it
		// can explain why 'PUBLISHED' is absent without tripping the rule. Comments
		// that must be scannable are a different problem from comments that must not.
		const allowed = statusCheck[1];
		for (const banned of [
			'PUBLISHED',
			'PUBLIC',
			'LIVE',
			'VISIBLE',
			'NAMED',
			'SHOWN',
			'RELEASED',
			'APPROVED'
		]) {
			if (new RegExp(`\\b${banned}\\b`, 'i').test(allowed))
				problems.push(
					`${PLAINCLOTHES}.status CHECK admits ${JSON.stringify(banned)}. Red line 2 is default-DENY with no publishable state at all: misidentifying a plainclothes officer gets an innocent person hurt, and a wrong name is not a correction later`
				);
		}
	}

	// No identity-shaped column, sealed or otherwise. A column that exists is a
	// column somebody fills, and the adjacent plaintext column is the one they
	// reach for.
	const IDENTITY_COL =
		/^\s*["'`]?(\w*(?:name|identity|identifier|alias|handle|photo|face|plate|phone|contact|address|social|badge)\w*)["'`]?\s+(?:TEXT|BLOB|INTEGER|REAL|NUMERIC)/gim;
	for (const m of pc.body.replace(/--.*$/gm, '').matchAll(IDENTITY_COL)) {
		problems.push(
			`${PLAINCLOTHES} declares column ${JSON.stringify(m[1])}. The claimed identity is NOT stored pending review, not even sealed — the right fix is a better column name (sealed_claim), not a looser rule`
		);
	}
}

// ---- 2. accountability_records keeps its two load-bearing CHECKs -------------
const ACCT = 'accountability_records';
const acct = bodies.get(ACCT);
if (!acct) {
	problems.push(`${ACCT} is not declared in any forward migration`);
} else {
	const flat = acct.body.replace(/--.*$/gm, '').replace(/\s+/g, ' ');

	// CONSTRAINT 1. Without it, rows in UNDER_REVIEW form a list of officials under
	// investigation: the target list red line 1 forbids, in a compellable database,
	// assembled by us.
	if (
		!/CHECK\s*\(\s*status\s*=\s*'PUBLISHED'\s+OR\s*\(\s*official_name\s+IS\s+NULL\s+AND\s+official_badge\s+IS\s+NULL\s*\)\s*\)/i.test(
			flat
		)
	)
		problems.push(
			`${ACCT} has lost the CHECK that an individual identifier may exist only in a PUBLISHED row. Without it, naming-pending-review is STORED, and a compelled dump of this table is a list of officials under investigation`
		);

	// CONSTRAINT 2. Every §8.2 condition in one expression, so removing one is a
	// visible deletion rather than a loosened branch in a Worker.
	const publishCheck = /CHECK\s*\(\s*status\s*<>\s*'PUBLISHED'\s+OR\s*\(([\s\S]*?)\)\s*\)/i.exec(
		flat
	);
	if (!publishCheck) {
		problems.push(
			`${ACCT} has lost the CHECK gating PUBLISHED on the §8.2 conditions. A Worker-side check is not a substitute: a compelled Worker can be compelled to skip an if`
		);
	} else {
		const conds = publishCheck[1];
		const required = [
			[/verification_state\s*=\s*'Human-Verified'/i, "verification_state = 'Human-Verified'"],
			[/cta_classifier_pass\s*=\s*1/i, 'cta_classifier_pass = 1'],
			[/documentary_anchor_sha256\s+IS\s+NOT\s+NULL/i, 'documentary_anchor_sha256 IS NOT NULL'],
			[/right_of_reply_ref\s+IS\s+NOT\s+NULL/i, 'right_of_reply_ref IS NOT NULL'],
			[/quorum_bundle\s+IS\s+NOT\s+NULL/i, 'quorum_bundle IS NOT NULL'],
			[/record_hash\s+IS\s+NOT\s+NULL/i, 'record_hash IS NOT NULL'],
			[/directory_epoch\s+IS\s+NOT\s+NULL/i, 'directory_epoch IS NOT NULL'],
			[/corroboration_count\s*>=\s*[3-9]/, 'corroboration_count >= 3']
		];
		for (const [re, label] of required)
			if (!re.test(conds))
				problems.push(
					`${ACCT}'s PUBLISHED CHECK no longer requires ${label}. Every §8.2 condition lives in that one expression so that dropping one is a visible deletion from a migration, not a quietly loosened if`
				);
	}

	// The autonomous ceiling. Community-Corroborated must never be publishable:
	// mapping an internal state UP to a stronger public label is a truth failure.
	if (/'Community-Corroborated'/i.test(publishCheck?.[1] ?? ''))
		problems.push(
			`${ACCT} would publish on Community-Corroborated. That is the AUTONOMOUS ceiling; Human-Verified is Layer-B only, and there must be no path from the autonomous layer to naming an individual`
		);
}

// ---- 3. The irreversible flags are LOCKED with no runtime read path ----------
//
// A LOCKED flag must not merely be off — it must have NO FLAG_NAMES entry, so
// `flagEnabled(kv, 'accountability_naming')` does not typecheck and the route's
// first statement is an unconditional refusal. "Off" is a value someone flips;
// "absent from the type" is a compile error.
const LOCKED_FLAGS = [
	'accountability_naming',
	'evidence_unredaction',
	'precise_location_reveal',
	'permanent_delete',
	'detainee_intake',
	'incommunicado_alert'
];
const policyPath = join(repoRoot, 'apps/console/src/flag-policy.ts');
const flagsPath = join(repoRoot, 'packages/worker-lib/src/flags.ts');
let policy = '';
let flagsSrc = '';
try {
	policy = read(policyPath);
} catch {
	problems.push('apps/console/src/flag-policy.ts is unreadable; the LOCKED set cannot be checked');
}
try {
	flagsSrc = read(flagsPath);
} catch {
	problems.push('packages/worker-lib/src/flags.ts is unreadable; FLAG_NAMES cannot be checked');
}

/**
 * The literal elements of `export const NAME = [ … ]`, by bracket depth.
 *
 * NOT a regex, and the first attempt here is why. `/FLIPPABLE[^=]*=\s*\[(.*?)\]/`
 * looks anchored but `[^=]*` is GREEDY and unanchored, so it walked past the
 * FLIPPABLE array to a later `= [` and captured the LOCKED list instead. Every
 * LOCKED flag then read as "appears in FLIPPABLE" — a gate reporting the exact
 * opposite of the truth, which is worse than no gate, because the fix somebody
 * would apply is to delete the flags from LOCKED.
 */
function constArray(source, name) {
	const decl = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]*)?=\\s*\\[`).exec(source);
	if (!decl) return null;
	let depth = 0;
	const from = decl.index + decl[0].length - 1;
	for (let i = from; i < source.length; i++) {
		const ch = source[i];
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) return source.slice(from + 1, i);
		}
	}
	return null;
}

// Comments blanked, not stripped, so offsets survive the depth scan.
const policyCode = blankComments(policy);
const lockedArr = constArray(policyCode, 'LOCKED') ?? '';
const flippableArr = constArray(policyCode, 'FLIPPABLE') ?? '';
// FLAG_NAMES is a "must not reference" check, so comments are STRIPPED: the
// reason a flag is absent is often written in a comment naming it.
const flagNamesArr = constArray(stripComments(flagsSrc, '.ts'), 'FLAG_NAMES');

if (policy && !lockedArr) problems.push('flag-policy.ts declares no LOCKED array');
if (flagsSrc && flagNamesArr === undefined)
	problems.push('flags.ts declares no FLAG_NAMES array, or its shape changed');

for (const flag of LOCKED_FLAGS) {
	const quoted = new RegExp(`['"\`]${flag}['"\`]`);
	if (policy && !quoted.test(lockedArr))
		problems.push(
			`${flag} is not in flag-policy.ts LOCKED. It gates an IRREVERSIBLE high-harm action and ships behind an unsatisfiable quorum`
		);
	if (policy && quoted.test(flippableArr))
		problems.push(
			`${flag} appears in FLIPPABLE. An irreversible action must never be one console click away`
		);
	if (flagNamesArr !== undefined && quoted.test(flagNamesArr))
		problems.push(
			`${flag} appears in FLAG_NAMES. A LOCKED flag must have NO runtime read path at all: with no entry, flagEnabled(kv, '${flag}') does not typecheck, so the route's first statement can only be an unconditional refusal. "Off" is a value someone flips`
		);
}

// ---- 4. No migration seeds a key directory or a reviewer set -----------------
//
// Zero rows IS the switch-off. With no reviewer box key there is no recipient
// set, so sealing refuses and the whole red-line-2 path is structurally dead.
// Populating either table is an offline m-of-n ceremony recorded in RUNBOOK, and
// a migration that did it would move that ceremony into a merged commit.
for (const file of migrationFiles) {
	const sql = stripComments(read(file), '.sql');
	for (const table of ['key_directory', 'reviewer_role_keys']) {
		if (new RegExp(`insert\\s+(?:or\\s+\\w+\\s+)?into\\s+["'\`]?${table}\\b`, 'i').test(sql))
			problems.push(
				`${file.replace(repoRoot, '.')} INSERTs into ${table}. Zero rows is the switch-off: keys are issued in an offline hardware-token ceremony recorded in RUNBOOK, never in a migration`
			);
	}
}

// ---- 5. Publishing a record sits beside a quorum verification ----------------
//
// A STRUCTURAL SMOKE ALARM, and it is honest about being one: the real guarantee
// is the reader's own verification in apps/web, which re-derives the canonical
// hash and re-checks m-of-n against the cached signed directory before it will
// render an individual identifier. This check only catches the obvious case — a
// handler that sets status='PUBLISHED' without a quorum call anywhere near it.
const APP_ROOTS = ['workers', 'apps'].map((d) => join(repoRoot, d));
for (const root of APP_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(ts|mjs)$/.test(file) || file.includes('.test.')) continue;
		const code = stripComments(read(file), '.ts');
		if (!/status\s*=\s*['"`]?\??\d*['"`]?\s*PUBLISHED|'PUBLISHED'/.test(code)) continue;
		// Only statements that WRITE the value are interesting; a comparison is not.
		if (!/UPDATE\s+accountability_records[\s\S]{0,400}?PUBLISHED/i.test(code)) continue;
		if (!/verifyRoleQuorum\s*\(/.test(code))
			problems.push(
				`${file.replace(repoRoot, '.')} sets accountability_records.status to PUBLISHED with no verifyRoleQuorum() call in the same file. This is a smoke alarm, not the guarantee — the guarantee is the reader's own check in apps/web/src/lib/accountability-verify.ts — but a publish path with no quorum call at all is a bug either way`
			);
	}
}

process.exit(fail(GATE, problems) ? 1 : 0);
