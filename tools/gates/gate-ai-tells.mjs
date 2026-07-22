// No-AI-tells / plain-language gate (CLAUDE.md ban list; PRD §15).
// Scans user-facing copy sources: message catalogs and content/ sources.
// Code and docs are out of scope — this guards what ships to a reader.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const COPY_ROOTS = [join(repoRoot, 'content')];
for (const app of ['web', 'console']) COPY_ROOTS.push(join(repoRoot, 'apps', app, 'messages'));

// [regex, reason]
const BANNED = [
	[/—/u, 'em-dash in user copy (use a full stop or comma; split the sentence)'],
	[/!/, 'exclamation mark in user copy'],
	[/\bblur(red|ring|s)?\b/i, '"blur" is banned — the tool is "cover / solid box" (§18.1)'],
	[/AI-checked/i, '"AI-checked" must never reach a user (§18.1)'],
	[/\bpanic\b/i, '"panic" is a tell — quick-exit is a plain "Close"'],
	[/\b(seamless|robust|leverage|elevate|empower|unlock|streamline|cutting-edge|effortless|one-stop)\b/i, 'marketing word'],
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
let scanned = 0;
for (const root of COPY_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(json|md|txt)$/.test(file)) continue;
		scanned++;
		const text = read(file);
		for (const [re, reason] of BANNED) {
			const m = text.match(re);
			if (m) {
				const line = text.slice(0, m.index).split('\n').length;
				problems.push(`${relative(repoRoot, file)}:${line} — ${reason} (${JSON.stringify(m[0])})`);
			}
		}
	}
}

if (fail('gate-ai-tells', problems)) process.exit(1);
console.log(`gate-ai-tells OK: ${scanned} copy file(s) clean`);
