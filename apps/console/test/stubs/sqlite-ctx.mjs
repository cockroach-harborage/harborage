// Real SQLite behind the DO storage.sql surface. See sqlite-ctx.d.ts for why this
// file is .mjs.
import { DatabaseSync } from 'node:sqlite';

/**
 * exec() runs EAGERLY. A lazy stub returning a thunk means the DO constructor's
 * CREATE TABLE never fires, and every later query fails against a table that does
 * not exist — which reads as a broken test rather than as a broken harness.
 */
export function sqliteCtx() {
	const db = new DatabaseSync(':memory:');
	const sql = {
		exec(query, ...args) {
			// Multi-statement DDL goes through exec(); everything else is prepared, so
			// bound parameters are real bound parameters and the constraints are real.
			if (args.length === 0 && /;\s*\S/.test(query.trim().replace(/;\s*$/, ''))) {
				db.exec(query);
				return { toArray: () => [] };
			}
			const stmt = db.prepare(query);
			if (/^\s*select/i.test(query)) {
				const rows = stmt.all(...args);
				return { toArray: () => rows };
			}
			stmt.run(...args);
			return { toArray: () => [] };
		}
	};
	return { storage: { sql } };
}
