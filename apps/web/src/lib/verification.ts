/**
 * The four honest public verification labels (PRD §15; CLAUDE.md content rules).
 * These are the ONLY labels shown to the public — never a score, never AI
 * machinery, never "verified" unless a person verified it. Internal states map
 * down to one of four kinds; colour is decoration only, the word is the signal.
 */
import { m } from '$lib/paraglide/messages.js';

export type LabelKind = 'team' | 'nearby' | 'unchecked' | 'problem';

/** Incident verification_state -> public label kind. Only team/nearby ever go public. */
export function incidentLabelKind(state: string): LabelKind {
	if (state === 'Verified' || state === 'Human-Verified') return 'team';
	if (state === 'Community-Corroborated' || state === 'Corroborating') return 'nearby';
	if (state === 'Disputed' || state === 'Debunked') return 'problem';
	return 'unchecked';
}

/** Directory verification_state -> public label kind. */
export function directoryLabelKind(state: string): LabelKind {
	if (state === 'Signed' || state === 'Verified') return 'team';
	if (state === 'Corroborating') return 'nearby';
	if (state === 'Quarantined') return 'problem';
	return 'unchecked'; // SelfListed, Stale
}

const LABELS: Record<LabelKind, () => string> = {
	team: m.label_team,
	nearby: m.label_nearby,
	unchecked: m.label_unchecked,
	problem: m.label_problem
};
const MEANINGS: Record<LabelKind, () => string> = {
	team: m.label_team_meaning,
	nearby: m.label_nearby_meaning,
	unchecked: m.label_unchecked_meaning,
	problem: m.label_problem_meaning
};

export function labelText(kind: LabelKind): string {
	return LABELS[kind]();
}
export function labelMeaning(kind: LabelKind): string {
	return MEANINGS[kind]();
}
