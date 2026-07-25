/**
 * Live-board vocabulary (PRD §4.5; ARCHITECTURE §6).
 *
 * Closed sets only. A board whose signal vocabulary can grow silently is a board
 * whose meaning drifts, and every reader would have to render a hazard it has
 * never seen.
 */

/**
 * The nine condition signals. Conditions, never people.
 *
 * §4.5 is explicit that condition data is the life-saving core and carries far
 * less targeting value than protestor location. There is deliberately no signal
 * here that describes a person, a group's composition, or anybody's intent.
 */
export const SIGNAL_TYPES = [
	'TEAR_GAS',
	'WATER_CANNON',
	'LATHI_CHARGE',
	'POLICE_MOVEMENT',
	'ROAD_BLOCK',
	'KETTLING_RISK',
	'SAFE_EXIT',
	'DISPERSAL',
	'AID_STATION'
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/**
 * Signals that publish ONLY with a marshal quorum.
 *
 * A wrong SAFE_EXIT walks people into a kettle, and a wrong DISPERSAL empties a
 * lawful assembly. §6.3: a community version without quorum is WITHHELD, not
 * shown with lower confidence.
 */
export const QUORUM_REQUIRED: readonly SignalType[] = ['SAFE_EXIT', 'DISPERSAL'];

export function requiresQuorum(signal: SignalType): boolean {
	return QUORUM_REQUIRED.includes(signal);
}

/**
 * What a reader receives for one zone.
 *
 * ABSENT BY TYPE, which is stronger than absent by convention: no count, no
 * reporter, no first_seen, no expires_at, no coordinate. There is no
 * `expires_at` because telling a client exactly when a signal will vanish is a
 * timing channel back to the moment it was reported.
 */
export interface BoardView {
	/** Coarse grid index, not a timestamp. */
	tick: number;
	zone_id: string;
	/**
	 * True for a window after construction.
	 *
	 * After eviction the board comes back empty, and empty is indistinguishable
	 * from "no hazards here". This is what lets the client keep showing cached
	 * rows with a STALE badge instead of flashing to nothing, which is the
	 * concrete form §6.5's "never dark" takes.
	 */
	rebuilding: boolean;
	/** Null when crowd bands are off, or under heightened threat. */
	band: string | null;
	signals: BoardSignal[];
}

export interface BoardSignal {
	signal: SignalType;
	/** At or above the corroboration bar. Never a number of reporters. */
	corroborated: boolean;
	/** A marshal quorum verified. Only ever true for a quorum-required signal. */
	marshal_verified: boolean;
}
