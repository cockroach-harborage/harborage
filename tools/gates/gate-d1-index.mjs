// D1 index gate (ARCHITECTURE §4.2: "rows-read = rows-scanned"). A public read
// board that filters on an unindexed column full-scans the table — slow, and at
// protest-day volume a self-inflicted availability problem. This gate connects
// the actual queries to the schema: every column a Worker/app FILTERS on
// (WHERE / AND / OR / ORDER BY) must be indexed or be (a prefix of) the primary
// key. It is deliberately CONSERVATIVE: it only fails on a high-confidence,
// single-table filter against a known column that has no index. Anything it
// cannot attribute confidently (joins, subqueries, computed columns) is skipped,
// not failed — a missed case is a review item, a false failure blocks CI.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

// ---- 1. Parse the schema from forward migrations -----------------------------
// tables: Map<table, { columns:Set, indexed:Set }>  (indexed = PK cols + index-leading cols)
const tables = new Map();

function ensure(table) {
	if (!tables.has(table)) tables.set(table, { columns: new Set(), indexed: new Set() });
	return tables.get(table);
}

const migrationsDir = join(repoRoot, 'migrations');
for (const file of walk(migrationsDir)) {
	if (!file.endsWith('.sql') || file.includes(`${'inverse'}/`)) continue;
	const sql = read(file);
	// CREATE TABLE <name> ( <body> )  — body is up to the matching close before a ';'
	for (const m of sql.matchAll(
		/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi
	)) {
		const table = m[1].toLowerCase();
		const body = m[2];
		const t = ensure(table);
		for (const rawLine of body.split('\n')) {
			const line = rawLine.replace(/--.*$/, '').trim(); // strip trailing comment
			if (!line) continue;
			const tablePk = line.match(/^primary\s+key\s*\(([^)]+)\)/i);
			if (tablePk) {
				for (const c of tablePk[1].split(','))
					t.indexed.add(c.trim().replace(/["'`]/g, '').toLowerCase());
				continue;
			}
			const col = line.match(/^["'`]?(\w+)["'`]?\s+/);
			if (!col) continue;
			const name = col[1].toLowerCase();
			if (['primary', 'foreign', 'unique', 'check', 'constraint'].includes(name)) continue;
			t.columns.add(name);
			if (/\bprimary\s+key\b/i.test(line)) t.indexed.add(name);
		}
	}
	// CREATE INDEX ... ON <table> ( <firstcol> , ... )  — leading column is usable
	for (const m of sql.matchAll(
		/create\s+(?:unique\s+)?index\s+[\w"'`]+\s+on\s+["'`]?(\w+)["'`]?\s*\(\s*["'`]?(\w+)/gi
	)) {
		ensure(m[1].toLowerCase()).indexed.add(m[2].toLowerCase());
	}
}

// ---- 2. Extract SQL string literals from worker/app code ---------------------
const SQL_ROOTS = ['workers', 'apps'].map((d) => join(repoRoot, d));
const OPS = String.raw`=|<|>|<=|>=|<>|!=|\bIN\b|\bLIKE\b|\bIS\b|\bBETWEEN\b`;

function analyzeQuery(sql) {
	// Single-table only, and no join/subquery we can't attribute.
	if (/\bjoin\b/i.test(sql)) return null;
	const from = sql.match(/\b(?:from|update|into)\s+["'`]?(\w+)["'`]?/i);
	if (!from) return null;
	const table = from[1].toLowerCase();
	if (!tables.has(table)) return null; // unknown table (e.g. sqlite_master) — skip
	// A second FROM/UPDATE/INTO (subquery) makes attribution ambiguous — skip.
	if ((sql.match(/\b(?:from|update|into)\s+\w/gi) || []).length > 1) return null;

	const filters = new Set();
	const whereBlock = sql.match(/\bwhere\b([\s\S]*?)(?:\bgroup\s+by\b|\border\s+by\b|\blimit\b|$)/i);
	if (whereBlock) {
		for (const w of whereBlock[1].matchAll(
			new RegExp(String.raw`["'\`]?(\w+)["'\`]?\s*(?:${OPS})`, 'gi')
		))
			filters.add(w[1].toLowerCase());
	}
	for (const o of sql.matchAll(/\border\s+by\s+["'`]?(\w+)/gi)) filters.add(o[1].toLowerCase());
	return { table, filters };
}

const problems = [];
let queries = 0;
for (const root of SQL_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(ts|js|svelte)$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
		const text = read(file);
		const rel = relative(repoRoot, file);
		// SQL passed to .prepare(`...`) / .exec(`...`) — capture the string literal.
		for (const call of text.matchAll(/\.(?:prepare|exec)\s*\(\s*(['"`])([\s\S]*?)\1/g)) {
			const sql = call[2];
			if (!/\b(select|insert|update|delete)\b/i.test(sql)) continue;
			const info = analyzeQuery(sql);
			if (!info) continue;
			queries++;
			const t = tables.get(info.table);
			for (const col of info.filters) {
				if (!t.columns.has(col)) continue; // not a real column (value/keyword) — skip
				if (!t.indexed.has(col))
					problems.push(`${rel}: filters ${info.table}.${col} but it is not indexed`);
			}
		}
	}
}

if (fail('gate-d1-index', problems)) process.exit(1);
console.log(`gate-d1-index OK: ${queries} attributable query/-ies, all filter columns indexed`);
