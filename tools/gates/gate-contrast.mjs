// AA contrast gate over packages/foundry/tokens.css (WCAG 2.2).
// Text-role pairs must reach 4.5:1; UI/large-role pairs 3:1, in both themes.
// If this fails, change the token (and PRD §15 in the same commit), not the gate.
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../packages/foundry/tokens.css', import.meta.url), 'utf8');

function themeVars(block) {
	const vars = {};
	for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2];
	return vars;
}
const lightBlock = css.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? '';
const darkBlock = css.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/s)?.[1] ?? '';
const light = themeVars(lightBlock);
const dark = { ...light, ...themeVars(darkBlock) };

function lum(hex) {
	const c = [1, 3, 5].map((i) => {
		const v = parseInt(hex.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(fg, bg) {
	const [a, b] = [lum(fg), lum(bg)];
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [foreground, background, minimum ratio]
const PAIRS = [
	['text', 'bg', 4.5],
	['text', 'surface', 4.5],
	['text-muted', 'bg', 4.5],
	['text-muted', 'surface', 4.5],
	['accent-text', 'accent', 4.5],
	['hazard', 'surface', 4.5],
	['safe', 'surface', 4.5],
	['caution', 'surface', 4.5],
	['info', 'surface', 4.5],
	['accent', 'bg', 3],
	['accent', 'surface', 3],
	['focus', 'bg', 3]
];

let failed = false;
for (const [name, vars] of [
	['light', light],
	['dark', dark]
]) {
	for (const [fg, bg, min] of PAIRS) {
		if (!vars[fg] || !vars[bg]) {
			console.error(`gate-contrast FAIL [${name}]: missing token --${fg} or --${bg}`);
			failed = true;
			continue;
		}
		const r = ratio(vars[fg], vars[bg]);
		if (r < min) {
			console.error(
				`gate-contrast FAIL [${name}]: --${fg} on --${bg} = ${r.toFixed(2)}:1 (needs ${min}:1)`
			);
			failed = true;
		}
	}
}
if (failed) process.exit(1);
console.log('gate-contrast OK: all token pairs meet AA in both themes');
