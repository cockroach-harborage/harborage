// Shared helpers for gate scripts.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Normally the repo. HARBORAGE_GATE_ROOT retargets every gate at a fixture tree
// so gate-selftest.mjs can prove each gate actually FAILS on a broken input.
// Without it no gate here had ever been shown to fail, and this repo has already
// shipped two that could not (see gate-sealed-body.mjs). The override is a
// test-harness affordance only: nothing in CI or the deploy path sets it, and
// every gate still reads the real repo when it is unset.
export const repoRoot = process.env.HARBORAGE_GATE_ROOT
	? resolve(process.env.HARBORAGE_GATE_ROOT)
	: fileURLToPath(new URL('../..', import.meta.url));

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'dist',
	'build',
	'.wrangler',
	'.terraform',
	'paraglide',
	'test-results',
	'playwright-report'
]);

export function* walk(dir) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* walk(path);
		else yield path;
	}
}

export function read(path) {
	return readFileSync(path, 'utf8');
}

export function fail(gate, problems) {
	if (problems.length === 0) return false;
	for (const p of problems) console.error(`${gate} FAIL: ${p}`);
	return true;
}

/**
 * Strip comments, for checks about what code DOES.
 *
 * The distinction matters and this repo has got it wrong in both directions.
 * A check like "this module must not reference localStorage" is about behaviour,
 * so a doc comment explaining that it deliberately does not use localStorage
 * must not trip it — otherwise every author reaches the same trap and the fix is
 * always to weaken the prose. Conversely gate-ai-tells scans message files
 * WITHOUT stripping, because there a comment is content, and gate-sealed-body
 * scans binding names in comments deliberately.
 *
 * Rule of thumb: strip for "must not reference", scan for "must not contain".
 */
export function stripComments(text) {
	return (
		text
			.replaceAll(/\/\*[\s\S]*?\*\//g, '')
			// Svelte templates carry HTML comments, and a template's own explanation of
			// what it does NOT do is exactly what trips a "must not reference" rule.
			// Missing this cost a fixture in gate-geo-granularity.
			.replaceAll(/<!--[\s\S]*?-->/g, '')
			.replaceAll(/(^|[^:])\/\/.*$/gm, '$1')
	);
}

/**
 * Blank out comments while PRESERVING every offset.
 *
 * For checks that compute character ranges — gate-jit-briefing places each send
 * affordance inside or outside an acknowledgement guard — stripping comments
 * outright would shift every offset and quietly corrupt the ranges, and the
 * reported positions would stop matching the file. Replacing comment bytes with
 * spaces (newlines kept, so line numbers survive) gives the same blindness to
 * comments with none of that risk.
 *
 * Covers JS block and line comments plus HTML/Svelte comments, because a Svelte
 * template can carry either and a comment mentioning `<form>` is exactly how
 * this bit me: a fixture's own explanation of what it does NOT contain tripped
 * the rule it was demonstrating.
 */
export function blankComments(text) {
	const blank = (m) => m.replaceAll(/[^\n]/g, ' ');
	return text
		.replaceAll(/\/\*[\s\S]*?\*\//g, blank)
		.replaceAll(/<!--[\s\S]*?-->/g, blank)
		.replaceAll(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + blank(m.slice(p1.length)));
}

/**
 * Split Hono router source into one region per route handler.
 *
 * WHY THIS EXISTS. Several gates need to assert that a guard runs INSIDE a
 * particular route's handler. A whole-file `text.includes('theGuard')` cannot
 * tell that apart from the guard sitting in the handler next door, so a route
 * can lose its guard entirely while the file still reads as guarded. That is
 * not hypothetical: it is the single most likely way an onion-only or
 * quorum-checked route quietly stops being one, because deleting four lines
 * from one handler leaves every other handler's copy in place.
 *
 * Shared here rather than copied, so gate-onion-only, gate-sealed-body and
 * gate-no-enumeration cannot drift into three subtly different ideas of where
 * a handler ends.
 *
 * A block starts at `app.<method>(` and ends at whichever comes first: the next
 * handler, or the next top-level declaration. The second bound matters for the
 * LAST handler in a file, which would otherwise swallow every helper defined
 * below it and count their contents as its own. Handler bodies are indented, so
 * a keyword at column 0 is reliably outside one.
 *
 * Deliberately conservative, like gate-d1-index: a route registered through
 * anything other than a literal `app.<method>('<path>'` is not returned at all.
 * A caller that needs completeness must check for absence itself, which
 * gate-onion-only does with its route-exists rule.
 */
const HANDLER_START_RE = /\bapp\s*\.\s*(get|post|put|patch|delete|all|on)\s*\(/g;
const HANDLER_PATH_RE = /^\s*app\s*\.\s*\w+\s*\(\s*(['"`])([^'"`]+)\1/;
const TOP_LEVEL_DECL_RE = /\n(?:export|async function|function|const|let|class|app\.notFound)\b/;

export function handlerBlocks(text, file = '') {
	const starts = [...text.matchAll(new RegExp(HANDLER_START_RE))];
	const blocks = [];
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i].index;
		const nextHandler = starts[i + 1]?.index ?? text.length;
		const rest = text.slice(start, nextHandler);
		// Trim at the first top-level declaration inside the candidate region.
		const decl = rest.search(TOP_LEVEL_DECL_RE);
		const body = decl === -1 ? rest : rest.slice(0, decl);
		const path = HANDLER_PATH_RE.exec(body);
		if (!path) continue;
		blocks.push({
			file,
			method: starts[i][1].toUpperCase(),
			path: path[2],
			text: body,
			start
		});
	}
	return blocks;
}
