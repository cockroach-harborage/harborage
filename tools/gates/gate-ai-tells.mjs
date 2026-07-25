// No-AI-tells / plain-language gate (CLAUDE.md ban list; PRD §15).
// Scans user-facing copy sources: message catalogs and content/ sources.
// Docs stay out of scope. App SOURCE is in scope for ONE narrow rule only (see
// SOURCE_ROOTS below) — a dial link is copy that happens to live in a template.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const COPY_ROOTS = [join(repoRoot, 'content')];
for (const app of ['web', 'console']) COPY_ROOTS.push(join(repoRoot, 'apps', app, 'messages'));

// NO STATE EMERGENCY NUMBER, ANYWHERE (maintainer decision, 2026-07-26).
//
// /get-help shipped a dial link to India's integrated state emergency line,
// which answers at a police control room. On a platform whose stated adversary
// is the state, that routes a protestor to the adversary and discloses their
// situation and their cell to it. The number was removed; these two rules are
// what stop it coming back as a convenience during a later pass.
//
// Every helpline this app offers instead comes from `resource_entries`, whose
// rows are organisations that consented to be listed. Those render through a
// variable href, so they do not match the source rule below.
const SOURCE_ROOTS = ['web', 'console'].map((app) => join(repoRoot, 'apps', app, 'src'));

// A hardcoded dialable number. A directory row renders the scheme followed by an
// interpolation, so the next character is not a digit and it does not match.
// That is the whole distinction: a number from the signed directory is fine, a
// number a developer typed is not.
const HARDCODED_DIAL_RE = /tel:\s*[+0-9]/;

// State emergency lines, as standalone tokens, in COPY only.
//
// The three-digit entries carry a real false-positive risk in prose. They are in
// the list anyway, deliberately: a false positive costs one reworded sentence,
// and safety copy is capped at 12 words so bare numerals are rare there. A false
// NEGATIVE costs someone a call to the police. When the cost of the two errors
// is that asymmetric, the gate should fire early.
const STATE_HELPLINE_RE = /\b(112|100|101|102|108|1090|1091|1098)\b/;

// [regex, reason]
const BANNED = [
	[/—/u, 'em-dash in user copy (use a full stop or comma; split the sentence)'],
	[/!/, 'exclamation mark in user copy'],
	[/\bblur(red|ring|s)?\b/i, '"blur" is banned — the tool is "cover / solid box" (§18.1)'],
	[/AI-checked/i, '"AI-checked" must never reach a user (§18.1)'],
	[/\bpanic\b/i, '"panic" is a tell — quick-exit is a plain "Close"'],
	[
		/\b(seamless|robust|leverage|elevate|empower|unlock|streamline|cutting-edge|effortless|one-stop)\b/i,
		'marketing word'
	],
	[/\bcurated\b/i, 'marketing word'],
	[/\bjourney\b/i, 'marketing metaphor'],
	[/\b(simply|easily)\b/i, 'fake-ease filler'],
	[/\bjust\b/i, 'fake-ease filler ("just")'],
	[/\bin order to\b/i, 'hedging ("in order to" — use "to")'],
	[/\b(please note|kindly|it seems|it appears)\b/i, 'hedging'],
	[/\b(let'?s dive in|let'?s get started|in this section|certainly)\b/i, 'filler opener'],
	[/\b(your voice matters|together we rise|we'?re here for you)\b/i, 'drama / fake warmth'],
	[/\butiliz?se?\b/i, '"use", not "utilise"'],
	[/\bsubmit\b/i, '"send", not "submit"'],
	[/\bfeed\b/i, '"posts" or "updates", not "feed"']
];

const problems = [];

/** Report one match with its file and line. */
function flag(file, text, m, reason) {
	const line = text.slice(0, m.index).split('\n').length;
	problems.push(`${relative(repoRoot, file)}:${line} — ${reason} (${JSON.stringify(m[0])})`);
}

let scanned = 0;
for (const root of COPY_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(json|md|txt)$/.test(file)) continue;
		scanned++;
		const text = read(file);
		for (const [re, reason] of BANNED) {
			const m = text.match(re);
			if (m) flag(file, text, m, reason);
		}
		const helpline = text.match(STATE_HELPLINE_RE);
		if (helpline)
			flag(
				file,
				text,
				helpline,
				'state emergency number in user copy: that line answers at a police control room, and this platform must never route a protestor there'
			);
	}
}

// The source rule. Deliberately ONE rule, not the whole ban list: code is full
// of legitimate identifiers the copy list forbids, and widening this scan would
// make the gate unusable and get it weakened. Comments are scanned along with
// everything else, so a comment here has to describe a dial link rather than
// spell one out. gate-sealed-body already imposes the same discipline on
// unseal-shaped binding names, and the answer is the same: reword the comment,
// never loosen the pattern.
let sourceScanned = 0;
for (const root of SOURCE_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(svelte|ts|js)$/.test(file)) continue;
		sourceScanned++;
		const text = read(file);
		const m = text.match(HARDCODED_DIAL_RE);
		if (m)
			flag(
				file,
				text,
				m,
				'hardcoded dial link: a number a developer typed is not a number an organisation consented to. Render it from resource_entries through a variable href, or do not offer it'
			);
	}
}

if (fail('gate-ai-tells', problems)) process.exit(1);
console.log(
	`gate-ai-tells OK: ${scanned} copy file(s) clean, ${sourceScanned} source file(s) carry no hardcoded dial link`
);
