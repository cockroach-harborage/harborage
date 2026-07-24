// Memory-only invariant, two gates (ARCHITECTURE §18.1, §17.5).
// Wholly-memory DO classes must never touch durable storage at all: one
// "persist for reliability" refactor silently recreates a compellable log
// (DO SQLite PITR is 30 days and cannot be disabled).
// Field-forbidden classes may use SQLite but never store the listed fields.
// Convention: a DO class lives in a file named <ClassName>.ts under src/do/.
import { join, relative, basename } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const WHOLLY_MEMORY = ['LiveBoard', 'Broker', 'Mailbox', 'RateLimit', 'CoordinationWindow'];
const FIELD_FORBIDDEN = {
	VerificationState:
		/\b(signal|location|lat|lng|latitude|longitude|timing|arrival|token_identity|token_to_identity|pubkey|public_key)\b/i
};
// SQLite-backed classes explicitly reviewed as holding non-personal state only
// (ARCHITECTURE §3.2, §18.3 "CI invariant class = —"). Listing a class here is a
// deliberate, reviewed classification — NOT a bypass.
const SQLITE_OK = [
	'FlagState',
	'NoticeLog',
	'CurationCoordinator',
	'ReviewGate',
	'SpendCap',
	'ReReviewQueue',
	'CustodyChain',
	'DeadlineTimer'
];
const STORAGE_RE =
	/\b(ctx\.storage|state\.storage|this\.storage|\.storage\.|sql\.exec|storage\.sql)\b/;

const problems = [];
const found = [];
for (const top of ['apps', 'workers']) {
	for (const file of walk(join(repoRoot, top))) {
		if (!/src\/do\/[^/]+\.ts$/.test(file.replaceAll('\\', '/'))) continue;
		const cls = basename(file, '.ts');
		const text = read(file);
		const rel = relative(repoRoot, file);
		found.push(cls);
		if (WHOLLY_MEMORY.includes(cls)) {
			const m = text.match(STORAGE_RE);
			if (m) problems.push(`${rel} — wholly-memory class ${cls} touches durable storage (${m[0]})`);
		} else if (cls in FIELD_FORBIDDEN) {
			const m = text.match(FIELD_FORBIDDEN[cls]);
			if (m)
				problems.push(`${rel} — field-forbidden class ${cls} references ${JSON.stringify(m[0])}`);
		} else if (!SQLITE_OK.includes(cls)) {
			// No silent bypass: an unclassified DO class fails. Classify it in one of
			// WHOLLY_MEMORY / FIELD_FORBIDDEN / SQLITE_OK (a reviewed decision).
			problems.push(
				`${rel} — DO class ${cls} is unclassified; add it to WHOLLY_MEMORY, FIELD_FORBIDDEN, or SQLITE_OK in gate-memory-only.mjs`
			);
		}
	}
}

// The verification_states migration must also stay clean of forbidden fields.
for (const file of walk(join(repoRoot, 'migrations'))) {
	if (!file.endsWith('.sql')) continue;
	const text = read(file);
	if (/verification_states/i.test(text)) {
		const m = text.match(FIELD_FORBIDDEN.VerificationState);
		if (m)
			problems.push(
				`${relative(repoRoot, file)} — forbidden field ${JSON.stringify(m[0])} in verification_states migration`
			);
	}
}

if (fail('gate-memory-only', problems)) process.exit(1);
console.log(
	`gate-memory-only OK (${found.length ? `checked: ${found.join(', ')}` : 'no invariant classes exist yet'})`
);
