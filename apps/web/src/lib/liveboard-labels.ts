/**
 * Signal and band labels, and the checking label a board row carries.
 *
 * WHY THESE ARE `Record<SignalType, …>` AND NOT A LOOKUP FUNCTION. A Record over
 * the closed union makes a signal added without a label a TYPECHECK error, which
 * is stronger than a test and much stronger than a fallback. The failure mode it
 * prevents is a new signal rendering as its raw enum name — `KETTLING_RISK` on
 * screen in front of someone who reads neither English nor code.
 *
 * THE CHECKING LABEL COMES FROM THE FOUR, AND ONLY THE FOUR (PRD §15). A board
 * row is not allowed its own vocabulary. Mapping a row UP to a stronger label is a
 * truth failure, not a copy nit: the label is the entire basis on which a reader
 * decides whether to act.
 */
import { m } from '$lib/paraglide/messages.js';
import type { Band, SignalType } from '@harborage/worker-lib/liveboard';

/** Plain words, verb-or-noun first, no jargon and no enum names. */
export const signalLabel: Record<SignalType, () => string> = {
	TEAR_GAS: m.sig_tear_gas,
	WATER_CANNON: m.sig_water_cannon,
	LATHI_CHARGE: m.sig_lathi_charge,
	POLICE_MOVEMENT: m.sig_police_movement,
	ROAD_BLOCK: m.sig_road_block,
	KETTLING_RISK: m.sig_kettling_risk,
	SAFE_EXIT: m.sig_safe_exit,
	DISPERSAL: m.sig_dispersal,
	AID_STATION: m.sig_aid_station
};

/**
 * Five words, never a number.
 *
 * The read route cannot send a count because BoardView has no field for one, and
 * this is the display half of the same rule: there is no code path from a band to
 * a numeral.
 */
export const bandLabel: Record<Band, () => string> = {
	none: m.band_none,
	small: m.band_small,
	moderate: m.band_moderate,
	large: m.band_large,
	'very-large': m.band_very_large
};

/**
 * Re-exported so a component has one import for board presentation. The mapping
 * itself lives in verification-map.ts, which imports nothing, so it is
 * unit-testable without the paraglide runtime — the same split verification.ts
 * uses for incidentLabelKind and directoryLabelKind.
 */
export { boardLabelKind } from './verification-map.ts';
