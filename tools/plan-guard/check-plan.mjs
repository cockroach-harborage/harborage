// Destroy guard over an OpenTofu plan (ARCHITECTURE §17.4, RUNBOOK Part B).
//
// RUNBOOK and the maintainer walkthrough both say: read the plan before
// approving, and a destroy on Email records, the Access application, or
// signing-key config is a bug — stop, do not apply. That instruction relies on
// a tired human spotting a red line in a wall of output at the moment they
// most want to click Approve. This makes the build do it.
//
// `prevent_destroy` in the tofu config covers D1, the Access application and
// the three R2 buckets. It does NOT cover the zone's SPF/DMARC records, the KV
// namespaces, the queues or the AI gateway — and the SPF/DMARC records are
// exactly what the walkthrough warns about, because losing them re-opens
// spoofing of the project's name. So the guard refuses EVERY destroy, not just
// the ones tofu already protects.
//
// Usage:  node tools/plan-guard/check-plan.mjs <plan.json>
//         HB_ALLOW_DESTROY="addr1,addr2" node ... (deliberate, reviewed removal)
//
// The plan JSON is read from disk and never re-emitted: it carries resource
// attributes in cleartext, and this repository is public.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
	console.error('plan-guard FAIL: no plan JSON given');
	process.exit(1);
}

let plan;
try {
	plan = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
	console.error(`plan-guard FAIL: cannot read ${path} — ${e.message}`);
	process.exit(1);
}

const changes = Array.isArray(plan.resource_changes) ? plan.resource_changes : [];
const allowed = new Set(
	(process.env.HB_ALLOW_DESTROY ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);

const counts = { create: 0, update: 0, delete: 0, replace: 0, 'no-op': 0 };
const destroys = [];

for (const change of changes) {
	const actions = change?.change?.actions ?? [];
	const address = change?.address ?? '(unknown)';
	const deletes = actions.includes('delete');
	const creates = actions.includes('create');

	if (deletes && creates) counts.replace++;
	else if (deletes) counts.delete++;
	else if (creates) counts.create++;
	else if (actions.includes('update')) counts.update++;
	else counts['no-op']++;

	// A replace is a destroy: the resource and everything it holds goes away
	// and a new one takes its name. For a bucket or a D1 database that is total
	// data loss, and it reads as an innocuous "~" in the summary line.
	if (deletes && !allowed.has(address)) {
		destroys.push({ address, actions: actions.join('+') });
	}
}

const summary = `create ${counts.create}, update ${counts.update}, replace ${counts.replace}, destroy ${counts.delete}, unchanged ${counts['no-op']}`;

if (destroys.length > 0) {
	console.error('plan-guard FAIL: this plan destroys or replaces existing resources.');
	for (const d of destroys) console.error(`  ${d.actions.padEnd(14)} ${d.address}`);
	console.error(
		'\nNothing has been applied. If a removal is genuinely intended, re-run with\n' +
			'HB_ALLOW_DESTROY set to the exact addresses above, and record why in RUNBOOK.md.'
	);
	console.error(`\nplan summary: ${summary}`);
	process.exit(1);
}

if (allowed.size > 0) {
	console.log(`plan-guard: ${allowed.size} destroy(s) explicitly allowed by HB_ALLOW_DESTROY`);
}
console.log(`plan-guard OK: no unapproved destroys (${summary})`);
