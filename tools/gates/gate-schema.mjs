// Forbidden-structure gate over D1 migrations (CLAUDE.md §2 structural invariants;
// DIR-1/DIR-2). These structures must not exist — enforced at the schema layer.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

// Tables that must never exist (member directory, social graph, sessions).
const FORBIDDEN_TABLE_RE =
	/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(users|members|accounts|sessions|profiles|followers|follows|friends|subscriptions|subscribers|vouches|presence|locations)\b/i;

// Columns that must never exist anywhere (real-name identity, money brokering,
// device rosters, natural-person home identity).
const FORBIDDEN_COLUMN_RE =
	/\b(real_name|full_name|home_address|aadhaar|passport|imei|imsi|sim_number|push_token|device_id|payment|donation|upi|ifsc|bank_account|amount_inr|price)\b/i;

const problems = [];
let scanned = 0;
for (const file of walk(join(repoRoot, 'migrations'))) {
	if (!file.endsWith('.sql')) continue;
	scanned++;
	const text = read(file);
	const rel = relative(repoRoot, file);
	let m = text.match(FORBIDDEN_TABLE_RE);
	if (m) problems.push(`${rel} — forbidden table ${JSON.stringify(m[1])}`);
	m = text.match(FORBIDDEN_COLUMN_RE);
	if (m) problems.push(`${rel} — forbidden column/word ${JSON.stringify(m[0])}`);
}

if (fail('gate-schema', problems)) process.exit(1);
console.log(`gate-schema OK: ${scanned} migration(s), no forbidden structures`);
