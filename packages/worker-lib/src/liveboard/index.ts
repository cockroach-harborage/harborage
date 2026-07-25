/**
 * Live board (ARCHITECTURE §6). Pure modules only: no Durable Object, no
 * bindings, no ambient state. The LiveBoard class is a thin wrapper around what
 * is here, which is what lets the red-line properties be tested directly rather
 * than through a route that returns a flat 403 to every probe.
 *
 * gate-action-vocabulary is deliberately NOT extended over this directory. It
 * exists for the autonomous trust engine, where `publish` must be absent from
 * the action enum because publishing an item's authority is irreversible.
 * `publishable()` here is a read-time predicate about a coarse hazard band, not
 * about an item's authority, and it is the correct English word. Widening the
 * gate would force a euphemism, which is worse than the word.
 */
export * from './params.ts';
export * from './types.ts';
export * from './hll.ts';
export * from './bands.ts';
export * from './publish.ts';
