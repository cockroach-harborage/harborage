/**
 * Archive primitives (ARCHITECTURE §16).
 *
 * Exposed as the `./archive` subpath rather than from the package barrel,
 * following the `./verification` precedent: the barrel is imported broadly and
 * these belong to one milestone's surface.
 *
 * Deliberately NOT placed under `src/verification/`. That directory is scanned
 * by gate-action-vocabulary, which bans irreversible verbs as plain substrings
 * and requires exactly one ACTIONS enum across it. These modules talk about
 * admission and probation and would fight that rule for no benefit.
 */
export * from './dhash.ts';
export * from './citable-id.ts';
export * from './probation.ts';
export * from './cohort.ts';
export * from './bsa-export.ts';
export * from './admission.ts';
