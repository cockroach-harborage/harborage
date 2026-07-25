// PASS fixture, and it EXERCISES every rule rather than avoiding them:
// an insert-only handler on the registry, a materializer that counts and binds
// the band through bandFor, a read of the rollup, and an ORG-constrained
// accommodation query.
import { Hono } from 'hono';
import { bandFor } from '@harborage/worker-lib/capacity';

export const app = new Hono();

app.post('/api/help/offer', async (c) => {
	// INSERT only. Deduplication is the UNIQUE index, not a read-then-write.
	await c.env.DB.prepare(
		`INSERT INTO helper_offers (id, region_bucket, skill, tier, dedup_token)
		 VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING`
	).run();
	return c.json({ ok: true, total: 7 }, 202);
});

app.get('/api/help/capacity', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT * FROM help_bands').all();
	return c.json({ bands: results }, 200);
});

app.get('/api/directory/shelter', async (c) => {
	const { results } = await c.env.DB.prepare(
		"SELECT * FROM resource_entries WHERE subcategory = 'temporary_accommodation' AND entity_type = 'ORG'"
	).all();
	return c.json({ entries: results }, 200);
});

export async function materialize(env) {
	const live = await env.DB.prepare(
		'SELECT region_bucket, skill, tier, COUNT(*) AS n FROM helper_offers GROUP BY region_bucket, skill, tier'
	).all();
	for (const row of live.results ?? []) {
		const band = bandFor(row.n, row.tier);
		await env.DB.prepare(
			`INSERT INTO help_bands (region_bucket, skill, tier, band, built_bucket, pack_epoch)
			 VALUES (?1, ?2, ?3, ?4, ?5, 0) ON CONFLICT DO UPDATE SET band = ?4`
		)
			.bind(row.region_bucket, row.skill, row.tier, band, '2026-07-26')
			.run();
	}
}
