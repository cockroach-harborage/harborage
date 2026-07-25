// Just-in-time safety briefing gate (PRD §4.7–4.9).
//
// The briefing is a precondition, not fine print. Somebody about to ask a
// stranger for help, or about to go and meet one, reads the risks AT THAT
// MOMENT — which is why the acknowledgement is memory-only and why "shown once
// per device" would be the opposite of what the feature is for.
//
// THE RULE IS ABSENCE, NOT DISABLEMENT. A disabled button is still a button, and
// Playwright's toBeHidden() passes for an element that does not exist, so it
// cannot tell the two apart. This gate computes the character ranges of every
// acknowledgement guard and requires every form and send affordance to lie
// inside one, which makes the "disabled button" version unbuildable rather than
// merely discouraged.
//
// HONEST BOUNDARY, stated in the registry and in /limits: the Worker cannot
// verify a briefing was shown without recording that it was, and that record is
// the kind this platform refuses to hold. This gate is client-side only.
import { join, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { repoRoot, walk, read, fail, blankComments, stripComments } from './lib.mjs';

const registryPath = join(repoRoot, 'tools/gates/jit-briefing-routes.json');
const modulePath = join(repoRoot, 'apps/web/src/lib/briefing.svelte.ts');
const componentPath = join(repoRoot, 'apps/web/src/lib/components/SafetyBriefing.svelte');
const layoutPath = join(repoRoot, 'apps/web/src/routes/+layout.svelte');
const wipePath = join(repoRoot, 'apps/web/src/lib/wipe.ts');

const problems = [];

if (!existsSync(registryPath)) {
	console.error('gate-jit-briefing FAIL: tools/gates/jit-briefing-routes.json is missing');
	process.exit(1);
}
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const routes = registry.routes ?? [];

/** Anything that sends, or that looks like it could. */
const SEND_RE = /<form\b|onsubmit=|data-send\b|type="submit"/g;
/** The guard: an {#if …isAcknowledged…} block. */
const GUARD_OPEN_RE = /\{#if[^}]*isAcknowledged[^}]*\}/g;

/**
 * Character ranges covered by an acknowledgement guard.
 *
 * Svelte blocks nest, so this counts {#if / {/if} depth from each guard's open
 * to its matching close rather than to the first {/if} it finds. Getting that
 * wrong would let a form after an inner {/if} count as guarded.
 */
function guardedRanges(text) {
	const ranges = [];
	for (const open of text.matchAll(GUARD_OPEN_RE)) {
		let depth = 1;
		let at = open.index + open[0].length;
		while (depth > 0 && at < text.length) {
			const nextOpen = text.indexOf('{#if', at);
			const nextClose = text.indexOf('{/if}', at);
			if (nextClose === -1) break;
			if (nextOpen !== -1 && nextOpen < nextClose) {
				depth++;
				at = nextOpen + 4;
			} else {
				depth--;
				at = nextClose + 5;
			}
		}
		ranges.push([open.index, at]);
	}
	return ranges;
}

// Comments stripped: rule 3 below is about what this module DOES, and its own
// doc comment necessarily names the stores it deliberately avoids.
const briefingSource = existsSync(modulePath) ? stripComments(read(modulePath)) : null;
if (briefingSource === null) {
	problems.push('apps/web/src/lib/briefing.svelte.ts is missing');
}

// --- 1. Every registered route imports and applies the guard ------------------
for (const raw of routes) {
	if (typeof raw !== 'object' || raw === null || typeof raw.route !== 'string') {
		problems.push(`registry entry is not an object with a "route": ${JSON.stringify(raw)}`);
		continue;
	}
	const abs = join(repoRoot, raw.route);
	if (!existsSync(abs)) {
		problems.push(`${raw.route} — registered as a compose surface but does not exist`);
		continue;
	}
	// Comments BLANKED rather than stripped: the range scan below places each send
	// affordance relative to a guard, so offsets must not move. A fixture comment
	// explaining that a page contains no <form> is what made this necessary.
	const text = blankComments(read(abs));
	if (!/isAcknowledged/.test(text)) {
		problems.push(
			`${raw.route} — does not call isAcknowledged. A compose surface with no briefing guard is fine print with extra steps`
		);
		continue;
	}
	// 2. Every send affordance lies inside a guard.
	const ranges = guardedRanges(text);
	for (const m of text.matchAll(SEND_RE)) {
		const inside = ranges.some(([from, to]) => m.index >= from && m.index < to);
		if (!inside)
			problems.push(
				`${raw.route} — ${JSON.stringify(m[0])} at offset ${m.index} is outside every isAcknowledged guard. The form must be ABSENT until acknowledged, not disabled: a disabled control is one console line from working, and toBeHidden() cannot tell the two apart`
			);
	}
	// 6. The topic must exist, so a route cannot invent one that is never set.
	if (briefingSource && typeof raw.topic === 'string') {
		if (!new RegExp(`'${raw.topic}'`).test(briefingSource))
			problems.push(
				`${raw.route} — topic ${JSON.stringify(raw.topic)} is not in BRIEFING_TOPICS, so isAcknowledged can never return true for it and the guard is permanent rather than just-in-time`
			);
	}
}

// --- 3. The module can persist nothing ---------------------------------------
if (briefingSource) {
	for (const forbidden of [
		'localStorage',
		'sessionStorage',
		'indexedDB',
		'openDB',
		'document.cookie',
		'navigator.storage',
		'fetch('
	]) {
		if (briefingSource.includes(forbidden))
			problems.push(
				`apps/web/src/lib/briefing.svelte.ts references ${JSON.stringify(forbidden)}. Persisting an acknowledgement makes the briefing shown-once, which is the opposite of just-in-time`
			);
	}
	// A Set would let a session accumulate acknowledgements until every compose
	// screen is open. One slot cannot.
	if (/new Set\b/.test(briefingSource))
		problems.push(
			'apps/web/src/lib/briefing.svelte.ts holds a Set. Acknowledging one briefing must not unlock another, and one slot is what makes that structural'
		);
	if (!/BRIEFING_TTL_MS/.test(briefingSource))
		problems.push(
			'apps/web/src/lib/briefing.svelte.ts has no TTL. An acknowledgement made forty minutes ago on a pocketed phone is not informed consent'
		);
}

// --- 4. Nothing outside the registry acknowledges ----------------------------
// The anti-fool clause: without it, a module elsewhere could set the
// acknowledgement (or write it to IndexedDB) and every rule above stays green.
const allowedAckFiles = new Set([
	relative(repoRoot, modulePath).replaceAll('\\', '/'),
	relative(repoRoot, componentPath).replaceAll('\\', '/'),
	...routes.map((r) => r.route)
]);
for (const file of walk(join(repoRoot, 'apps/web/src'))) {
	if (!/\.(svelte|ts)$/.test(file)) continue;
	const rel = relative(repoRoot, file).replaceAll('\\', '/');
	if (allowedAckFiles.has(rel)) continue;
	const text = read(file);
	if (/\backnowledge\s*\(/.test(stripComments(text)))
		problems.push(
			`${rel} — calls acknowledge(). Only the briefing component and a registered compose surface may, or the acknowledgement can be set from somewhere with no briefing on screen`
		);
}

// --- 5. Quick exit and erase both clear it ----------------------------------
for (const [path, what] of [
	[layoutPath, 'quick exit'],
	[wipePath, 'device erase']
]) {
	if (!existsSync(path)) continue;
	if (!/forgetBriefing\s*\(/.test(read(path)))
		problems.push(
			`${relative(repoRoot, path)} — ${what} does not call forgetBriefing(). Neither may leave a screen one tap from a compose form`
		);
}

if (fail('gate-jit-briefing', problems)) process.exit(1);
console.log(
	`gate-jit-briefing OK: ${routes.length} compose surface(s) render no send affordance outside an acknowledgement guard`
);
