// Trust-engine action vocabulary (ARCHITECTURE §15, §18.5-P2; CLAUDE.md).
//
// The organizing rule of the whole trust engine:
//
//   AI and community may act autonomously ONLY on reversible, non-catastrophic
//   actions. Every irreversible, high-harm action stays m-of-n human-gated.
//
// The enforcement is structural rather than conditional: the action enum has no
// publish verb, no delete verb, no unredact verb, no name verb. Not disabled,
// not flag-gated — ABSENT. A model output cannot reach one because none exists.
//
// §18.5-P2 asks for "a guard that the fixed action-enum has no code path to
// publish/delete/unredact/name". A unit test asserting the enum only restates
// the enum. This reads the trust-engine source and fails the BUILD if an
// irreversible verb appears anywhere in its executable code, including in a
// helper some later change might call.
//
// Comments are stripped before scanning: the module legitimately discusses the
// words it must not act on, and a rule that punished the explanation would
// pressure someone into deleting the explanation.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

/** Where the autonomous decision path lives. */
const TRUST_ROOTS = ['packages/worker-lib/src/verification'];

const EXPECTED_ACTIONS = ['label', 'rank', 'hide-pending', 'retain-pending', 'route-to-gate'];

/**
 * Verbs that name an irreversible, high-harm action. `name` is included because
 * publishing an individual's identity is the single most dangerous thing this
 * system could do, and it is the one whose code would look most innocuous.
 */
const IRREVERSIBLE = [
	'publish',
	'unpublish',
	'delete',
	'destroy',
	'purge',
	'erase',
	'unredact',
	'reveal',
	'deanonymize',
	'deanonymise',
	'identify'
];

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
}

const problems = [];
let scanned = 0;
let sawEnum = false;

for (const root of TRUST_ROOTS) {
	for (const file of walk(join(repoRoot, root))) {
		if (!/\.ts$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
		scanned++;
		const rel = relative(repoRoot, file);
		const text = read(file);
		const code = stripComments(text);

		for (const verb of IRREVERSIBLE) {
			// Plain substring, case-insensitive, NOT a word-boundary match. A
			// \bpublish\b rule sails straight past `publishItem()`, which is
			// exactly how the dangerous version would be written. The scanned
			// surface is one small pure module, so the false-positive cost is
			// low and the friction is appropriate for this particular path: if a
			// legitimate `Map.delete` is ever needed here, restructuring is the
			// right answer, not loosening this.
			const re = new RegExp(verb, 'i');
			if (re.test(code)) {
				problems.push(
					`${rel} — the autonomous decision path names the irreversible action "${verb}". Reversible actions only: ${EXPECTED_ACTIONS.join(', ')}. Irreversible actions are m-of-n human-gated and live elsewhere.`
				);
			}
		}

		// The enum itself must stay exactly the five reversible verbs.
		const block = /export\s+const\s+ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/.exec(text);
		if (block) {
			sawEnum = true;
			const found = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
			const extra = found.filter((a) => !EXPECTED_ACTIONS.includes(a));
			const missing = EXPECTED_ACTIONS.filter((a) => !found.includes(a));
			if (extra.length > 0)
				problems.push(`${rel} — ACTIONS contains ${JSON.stringify(extra)}, outside the fixed enum`);
			if (missing.length > 0)
				problems.push(`${rel} — ACTIONS is missing ${JSON.stringify(missing)}`);
		}
	}
}

// A vocabulary nobody declares is a vocabulary nobody is enforcing.
if (scanned > 0 && !sawEnum) {
	problems.push(
		'no ACTIONS enum found in the trust-engine path; it must be declared as `export const ACTIONS = [...] as const;`'
	);
}

if (fail('gate-action-vocabulary', problems)) process.exit(1);
console.log(
	`gate-action-vocabulary OK: ${scanned} trust-engine file(s), no irreversible verb on the autonomous path`
);
