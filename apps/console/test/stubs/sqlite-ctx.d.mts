/**
 * Types for the real-SQLite DO context harness.
 *
 * WHY A .mjs HELPER WITH A HAND-WRITTEN .d.ts, rather than importing node:sqlite
 * from the test directly. This package's tsconfig sets
 * `types: ["@cloudflare/workers-types"]` and nothing else, on purpose: the console
 * runs on workerd, and admitting @types/node here would make `fs` and `process`
 * typecheck inside a Worker. Importing node:sqlite from a .ts test therefore fails
 * `tsc` while passing under vitest — the same split that shipped a green-under-
 * vitest, red-under-svelte-check test earlier in this build.
 *
 * So the Node-only dependency lives in an untypechecked .mjs file and is described
 * here, which keeps the Workers type boundary intact and the test typed.
 */

/** A DurableObjectState-shaped object whose storage.sql is real SQLite in memory. */
export function sqliteCtx(): DurableObjectState;
