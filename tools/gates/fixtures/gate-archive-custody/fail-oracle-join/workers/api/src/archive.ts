// Fixture: assembling the oracle at query time from two innocent tables.
export async function oracle(env: { DB: D1Database }, sha: string) {
	return env.DB.prepare(
		'SELECT p.dhash64 FROM perceptual_hashes p, evidence_keyrings k WHERE k.original_sha256 = ?1'
	).bind(sha).all();
}
