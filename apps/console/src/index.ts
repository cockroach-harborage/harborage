/**
 * Privileged console (M0: kill-switch admin). Every route is fail-closed
 * behind Access JWT verification — there is no bypass path, by design (§17.4).
 * No client-side JavaScript: plain forms, server-rendered HTML, script-src none.
 */
import { Hono } from 'hono';
import { verifyAccess, type AccessIdentity } from '@harborage/worker-lib/access';
import { flagEnabled } from '@harborage/worker-lib/flags';
import { safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import type { ConsoleEnv } from '@harborage/worker-lib/types';
import { FLIPPABLE, LOCKED } from './flag-policy.ts';
import type { AuditRow, FlagRow } from './do/FlagState.ts';
import type { FlagRecord } from '@harborage/worker-lib/flags';
import { publishNotice, listNotices, chainStatus } from './notices.ts';

export { FlagState } from './do/FlagState.ts';
export { NoticeLog } from './do/NoticeLog.ts';

interface FlagStateStub {
	list(): Promise<FlagRow[]>;
	auditTail(limit?: number): Promise<AuditRow[]>;
	flip(name: string, enabled: boolean, actor: string, reason: string): Promise<FlagRecord | null>;
}

type Ctx = { Bindings: ConsoleEnv; Variables: { identity: AccessIdentity } };

const app = new Hono<Ctx>();

app.use('*', async (c, next) => {
	const identity = await verifyAccess(c.req.raw, c.env);
	if (!identity) {
		safeLog('console_denied', { route: c.req.path, statusClass: '4xx' });
		return c.text('denied', 403);
	}
	c.set('identity', identity);
	await next();
	c.header(
		'Content-Security-Policy',
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
	);
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('X-Frame-Options', 'DENY');
	c.header('Cache-Control', 'no-store');
});

function flagStub(env: ConsoleEnv): FlagStateStub {
	const ns = env.FLAG_STATE;
	return ns.get(ns.idFromName('global')) as unknown as FlagStateStub;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

app.get('/', async (c) => {
	const stub = flagStub(c.env);
	const [flags, audit] = await Promise.all([stub.list(), stub.auditTail(30)]);
	const state = new Map(flags.map((f) => [f.name, f]));
	const rows = FLIPPABLE.map((name) => {
		const f = state.get(name);
		const on = f?.enabled === 1;
		return `<tr>
			<td>${esc(name)}</td>
			<td>${on ? 'ON' : 'off'}</td>
			<td>epoch ${f?.epoch ?? 0}</td>
			<td>
				<form method="post" action="/flags/${esc(name)}">
					<input type="hidden" name="enabled" value="${on ? 'false' : 'true'}" />
					<input name="reason" placeholder="reason (required)" required />
					<button>${on ? 'Turn off' : 'Turn on'}</button>
				</form>
			</td>
		</tr>`;
	}).join('');
	const locked = LOCKED.map((name) => `<tr><td>${esc(name)}</td><td>LOCKED OFF</td></tr>`).join('');
	const auditRows = audit
		.map(
			(a) =>
				`<tr><td>${esc(a.at)}</td><td>${esc(a.name)}</td><td>${esc(a.action)}</td><td>${esc(a.actor)}</td><td>${esc(a.reason)}</td></tr>`
		)
		.join('');
	return c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Harborage console</title>
<style>body{font-family:system-ui;max-width:64rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}td,th{border:1px solid #ccc;padding:.4rem;text-align:left}</style>
</head><body>
<h1>Kill switches</h1>
<p>Flags fail closed. Propagation takes up to the cache TTL per colo, not zero.</p>
<table><tr><th>Flag</th><th>State</th><th>Epoch</th><th>Flip</th></tr>${rows}</table>
<h2>Irreversible gates</h2>
<p>Built, permanently off. No console path can enable these. Unlocking is a governed code change.</p>
<table><tr><th>Gate</th><th>State</th></tr>${locked}</table>
<h2>Audit (latest 30)</h2>
<table><tr><th>At</th><th>Flag</th><th>Action</th><th>Actor</th><th>Reason</th></tr>${auditRows}</table>
</body></html>`);
});

app.post('/flags/:name', async (c) => {
	// Same-origin check: forms only, no cross-site flips.
	const origin = c.req.header('Origin');
	if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text('denied', 403);

	const name = c.req.param('name');
	const form = await c.req.parseBody();
	const enabled = form['enabled'] === 'true';
	const reason = typeof form['reason'] === 'string' ? form['reason'].slice(0, 200) : '';
	if (!reason) return c.text('reason required', 400);

	const identity = c.get('identity');
	const result = await flagStub(c.env).flip(name, enabled, identity.sub, reason);
	safeLog('flag_flip', {
		flag: name,
		outcome: result ? (enabled ? 'enabled' : 'disabled') : 'refused',
		statusClass: statusClass(result ? 303 : 403)
	});
	if (!result) return c.text('refused: locked or unknown flag', 403);
	return c.redirect('/', 303);
});

// --- Official Notices: upload-a-signed-notice (never compose-and-sign) --------
function noticesPage(opts: {
	published: boolean;
	notices: Awaited<ReturnType<typeof listNotices>>;
	status: Awaited<ReturnType<typeof chainStatus>>;
	message?: string;
}): string {
	const rows = opts.notices
		.map(
			(n) =>
				`<tr><td>${esc(n.id)}</td><td>${esc(n.notice_type)}</td><td>epoch ${n.epoch}</td><td>${esc(n.published_at)}</td><td>${n.superseded_by ? 'superseded' : 'current'}</td></tr>`
		)
		.join('');
	const banner = opts.message ? `<p class="msg">${esc(opts.message)}</p>` : '';
	const form = opts.published
		? `<form method="post" action="/notices">
				<p>Paste a notice bundle signed offline by the role keys (JSON: {payload, signatures}).</p>
				<textarea name="bundle" rows="10" cols="80" required></textarea>
				<button>Verify and publish</button>
			</form>`
		: `<p>Publishing is off. Turn on <code>notices_publish</code> to open this surface.</p>`;
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Official notices</title>
<style>body{font-family:system-ui;max-width:64rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}td,th{border:1px solid #ccc;padding:.4rem;text-align:left}textarea{width:100%;font-family:monospace}.msg{padding:.6rem;border:1px solid #888;background:#f4f4f4}</style>
</head><body>
<p><a href="/">Kill switches</a></p>
<h1>Official notices</h1>
<p>Chain length ${opts.status.count}. Head ${esc(opts.status.head.slice(0, 16))}...</p>
${banner}
<h2>Publish</h2>
<p>The server verifies the m-of-n signatures against the signed key directory and appends only a valid quorum. It holds no private keys.</p>
${form}
<h2>Published notices (latest 50)</h2>
<table><tr><th>Id</th><th>Type</th><th>Epoch</th><th>Published</th><th>State</th></tr>${rows}</table>
</body></html>`;
}

app.get('/notices', async (c) => {
	const published = await flagEnabled(c.env.FLAGS, 'notices_publish');
	const [notices, status] = await Promise.all([listNotices(c.env), chainStatus(c.env)]);
	return c.html(noticesPage({ published, notices, status }));
});

app.post('/notices', async (c) => {
	const origin = c.req.header('Origin');
	if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text('denied', 403);

	if (!(await flagEnabled(c.env.FLAGS, 'notices_publish'))) return c.text('not open', 403);

	const form = await c.req.parseBody();
	const bundle = typeof form['bundle'] === 'string' ? form['bundle'] : '';
	const result = await publishNotice(c.env, bundle);
	safeLog('notice_publish', {
		outcome: result.ok ? 'published' : 'refused',
		statusClass: statusClass(result.ok ? 200 : 403)
	});
	const [notices, status] = await Promise.all([listNotices(c.env), chainStatus(c.env)]);
	return c.html(
		noticesPage({ published: true, notices, status, message: result.message }),
		result.ok ? 200 : 400
	);
});

export default app;
