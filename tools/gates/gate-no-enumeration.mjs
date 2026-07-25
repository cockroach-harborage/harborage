// No-enumeration gate (CLAUDE.md §2 "no member directory / list-all-users";
// PRD §4.9 "registry never publicly browsable — a supporter list is a target
// list").
//
// `skills_registry` is where a supporter list would live if anyone were
// careless. The table is built so it holds nothing from which a person could be
// reached, and this gate is what keeps that true as routes are added around it:
// the schema says what CANNOT be stored, and this says what cannot be ASKED.
//
// The load-bearing rule is (B): no route may SELECT from a registry table at
// all. Not "must be limited" — absent. A limit is a number someone raises while
// improving an error message; an absence is something they have to argue for.
//
// Reuses gate-d1-index's schema parsing approach and gate-onion-only's handler
// splitter, so all three gates agree on what a table is and where a handler
// ends.
import { join, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { repoRoot, walk, read, fail, handlerBlocks } from './lib.mjs';

const classesPath = join(repoRoot, 'tools/gates/enumeration-classes.json');
const problems = [];

if (!existsSync(classesPath)) {
	console.error('gate-no-enumeration FAIL: tools/gates/enumeration-classes.json is missing');
	process.exit(1);
}
const classes = JSON.parse(readFileSync(classesPath, 'utf8'));
const REGISTRY = new Set(classes.registry ?? []);
const MATERIALIZED = classes.materialized ?? {};
const ORDINARY = new Set(classes.ordinary ?? []);

// --- Schema, from the forward migrations -------------------------------------
/** table -> { columns: Map<name, declType>, checks: string[] } */
const tables = new Map();
for (const file of walk(join(repoRoot, 'migrations'))) {
	if (!file.endsWith('.sql') || file.replaceAll('\\', '/').includes('/inverse/')) continue;
	const sql = read(file);
	for (const m of sql.matchAll(
		/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi
	)) {
		const name = m[1].toLowerCase();
		const body = m[2];
		const columns = new Map();
		for (const rawLine of body.split('\n')) {
			const line = rawLine.replace(/--.*$/, '').trim();
			if (!line) continue;
			const col = /^["'`]?(\w+)["'`]?\s+(\w+)/.exec(line);
			if (!col) continue;
			const cname = col[1].toLowerCase();
			if (['primary', 'foreign', 'unique', 'check', 'constraint'].includes(cname)) continue;
			columns.set(cname, col[2].toUpperCase());
		}
		tables.set(name, { columns, body });
	}
}

// --- SQL literals, attributed to a file and a handler block ------------------
/**
 * SQL string literals, in all three quote styles, ANCHORED to start with a SQL
 * verb.
 *
 * Two bugs live here, both found by fixtures rather than by reading.
 *
 * 1. DOUBLE QUOTES WERE MISSING, and the real repo uses them:
 *    `"SELECT * FROM resource_entries WHERE status = 'LIVE'"` in the directory
 *    route. Every rule below was evadable by changing a quote character, and the
 *    hole was invisible against the real repo because that one query happened to
 *    be classified `ordinary` either way.
 * 2. Adding the double-quote branch unanchored made it WORSE, not better:
 *    `"[^"]*SELECT[^"]*"` happily spans from one unrelated quote to another,
 *    swallowing whole function bodies and attributing their tables to the wrong
 *    place. The accommodation fixture stayed green through both versions.
 *
 * Anchoring on the verb fixes both. A real query begins with SELECT, INSERT,
 * UPDATE or DELETE, possibly after the leading whitespace of a template
 * literal. A span that merely CONTAINS one of those words somewhere is a
 * coincidence, not a query.
 */
const VERB = String.raw`\s*(?:select|insert|update|delete)\b`;
const SQL_RE = new RegExp(`"(${VERB}[^"]*)"|\`(${VERB}[^\`]*)\`|'(${VERB}[^']*)'`, 'gi');

/** The captured literal, whichever quote style matched. */
function sqlOf(m) {
	return m[1] ?? m[2] ?? m[3] ?? '';
}
const sources = [];
for (const top of ['workers', 'apps']) {
	for (const file of walk(join(repoRoot, top))) {
		if (!/\.ts$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
		sources.push({ rel: relative(repoRoot, file), text: read(file) });
	}
}

/** Which tables a SQL literal names. */
function tablesIn(sql) {
	const found = new Set();
	for (const m of sql.matchAll(/\b(?:from|into|update|join)\s+["'`]?(\w+)["'`]?/gi))
		found.add(m[1].toLowerCase());
	return found;
}

// --- (A) every table used in code is classified ------------------------------
const usedTables = new Set();
for (const { text } of sources) {
	for (const m of text.matchAll(SQL_RE)) {
		for (const t of tablesIn(sqlOf(m))) if (tables.has(t)) usedTables.add(t);
	}
}
for (const t of usedTables) {
	if (REGISTRY.has(t) || t in MATERIALIZED || ORDINARY.has(t)) continue;
	problems.push(
		`table ${JSON.stringify(t)} is queried in code but is unclassified; add it to "registry", "materialized" or "ordinary" in tools/gates/enumeration-classes.json (a reviewed decision, not a bypass)`
	);
}

// --- (B) and (C): registry reads --------------------------------------------
for (const { rel, text } of sources) {
	const blocks = handlerBlocks(text, rel);
	for (const m of text.matchAll(SQL_RE)) {
		const sql = sqlOf(m).replace(/\s+/g, ' ').trim();
		const hit = [...tablesIn(sql)].filter((t) => REGISTRY.has(t));
		if (hit.length === 0) continue;
		const inHandler = blocks.some((b) => m.index >= b.start && m.index < b.start + b.text.length);
		const isSelect = /^\s*select\b/i.test(sql);

		// (B) No registry SELECT inside a request handler. Absent, not limited.
		if (isSelect && inHandler) {
			problems.push(
				`${rel} — a request handler SELECTs from registry table ${JSON.stringify(hit[0])}. Only a Cron materializer may read it: a route that can read it is a route that can be asked about a person`
			);
			continue;
		}
		// (C) A registry SELECT outside a handler must be an aggregate, never rows.
		if (isSelect && !inHandler && !/\bcount\s*\(/i.test(sql)) {
			problems.push(
				`${rel} — a registry SELECT that is not a COUNT: ${JSON.stringify(sql.slice(0, 90))}. The materializer counts; nothing reads rows`
			);
		}
	}
}

// --- (D) no count reaches a response ----------------------------------------
for (const { rel, text } of sources) {
	for (const block of handlerBlocks(text, rel)) {
		const touchesRegistry = [...block.text.matchAll(SQL_RE)].some((m) =>
			[...tablesIn(sqlOf(m))].some((t) => REGISTRY.has(t))
		);
		if (!touchesRegistry) continue;
		const key = /\b(count|cnt|total|num_|n_)\w*\s*:/.exec(block.text);
		if (key)
			problems.push(
				`${rel} — the handler for ${block.method} ${block.path} touches a registry table and puts ${JSON.stringify(key[0])} in a response object. A band, never a count`
			);
	}
}

// --- (E) the materialized table holds no number ------------------------------
for (const [name, spec] of Object.entries(MATERIALIZED)) {
	const t = tables.get(name);
	if (!t) {
		problems.push(`materialized table ${JSON.stringify(name)} has no CREATE TABLE in migrations/`);
		continue;
	}
	const allowed = new Set((spec.integer_allowlist ?? []).map((c) => c.toLowerCase()));
	for (const [col, declType] of t.columns) {
		if (declType !== 'TEXT' && !allowed.has(col))
			problems.push(
				`migrations — ${name}.${col} is declared ${declType}. A published rollup carries a band, never a number: add it to integer_allowlist only if it genuinely cannot encode a population`
			);
		if (/count|cnt|total|\bnum\b|\bn\b/i.test(col) && !allowed.has(col))
			problems.push(`migrations — ${name}.${col} is named like a count`);
	}
	// The vocabulary is pinned in the CHECK, so it cannot silently gain 'TWO'.
	const values = (spec.band_values ?? []).map((v) => `'${v}'`).join(',');
	const wanted = new RegExp(
		`CHECK\\s*\\(\\s*${spec.band_column}\\s+IN\\s*\\(\\s*${values.replaceAll(',', '\\s*,\\s*')}\\s*\\)`,
		'i'
	);
	if (!wanted.test(t.body.replace(/\s+/g, ' ')))
		problems.push(
			`migrations — ${name}.${spec.band_column} must carry a CHECK pinning it to exactly ${values}. Without it the vocabulary can gain a value that is a count in disguise`
		);
}

// --- (F) the band is bound, never inlined ------------------------------------
for (const { rel, text } of sources) {
	for (const m of text.matchAll(SQL_RE)) {
		const sql = sqlOf(m).replace(/\s+/g, ' ').trim();
		const target = [...tablesIn(sql)].find((t) => t in MATERIALIZED);
		if (!target || !/^\s*insert\b/i.test(sql)) continue;
		const spec = MATERIALIZED[target];
		for (const v of spec.band_values ?? []) {
			if (sql.includes(`'${v}'`))
				problems.push(
					`${rel} — the INSERT into ${target} inlines the band literal '${v}'. Bind it, and compute it in bandFor(), so the thresholds live somewhere a test can sweep them instead of inside SQL nothing can reach`
				);
		}
		if (!/\bbandFor\b/.test(text))
			problems.push(
				`${rel} — writes ${target} but never imports bandFor. The thresholds decide how much an adversary learns from a published band and must not be reimplemented here`
			);
	}
}

// --- (G) the accommodation interlock -----------------------------------------
for (const { rel, text } of sources) {
	for (const m of text.matchAll(SQL_RE)) {
		const sql = sqlOf(m).replace(/\s+/g, ' ').trim();
		if (!/temporary_accommodation/i.test(sql)) continue;
		if (!/entity_type\s*=\s*'?ORG'?/i.test(sql))
			problems.push(
				`${rel} — a query mentions temporary_accommodation without constraining entity_type to 'ORG'. PRD §4.8: short-term housing is brokered only through vetted institutional shelters, never stranger-to-home`
			);
	}
}
for (const [name, t] of tables) {
	if (!REGISTRY.has(name)) continue;
	const skillCheck = /skill\s+TEXT[^,]*CHECK\s*\(\s*skill\s+IN\s*\(([^)]*)\)/i.exec(
		t.body.replace(/\s+/g, ' ')
	);
	if (!skillCheck) continue;
	for (const m of skillCheck[1].matchAll(/'([^']+)'/g)) {
		if (/accommod|housing|host|stay|shelter/i.test(m[1]))
			problems.push(
				`migrations — ${name}.skill admits ${JSON.stringify(m[1])}. There must be no row shape for "this person will host you": housing is admitted only as an organisation in resource_entries`
			);
	}
}

if (fail('gate-no-enumeration', problems)) process.exit(1);
console.log(
	`gate-no-enumeration OK: ${REGISTRY.size} registry table(s) unreadable from any route, ${Object.keys(MATERIALIZED).length} rollup(s) carrying bands and no counts`
);
