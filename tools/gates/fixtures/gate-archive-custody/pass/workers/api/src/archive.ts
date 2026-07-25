// Fixture: the two tables queried SEPARATELY is the allowed shape, and the gate
// must not fire on it. Without this the "no oracle join" rule would be proven
// only by the absence of any query at all.
export async function candidates(env: { DB: D1Database }, band0: string) {
	return env.DB.prepare('SELECT derivative_sha256, dhash64 FROM perceptual_hashes WHERE band0 = ?1').bind(band0).all();
}
export async function keyring(env: { DB: D1Database }, sha: string) {
	return env.DB.prepare('SELECT tier FROM evidence_keyrings WHERE original_sha256 = ?1').bind(sha).all();
}
