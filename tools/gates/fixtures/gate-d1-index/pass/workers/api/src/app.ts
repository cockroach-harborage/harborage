export async function load(env) {
	return env.DB.prepare('SELECT id FROM things WHERE kind = ?').all();
}
