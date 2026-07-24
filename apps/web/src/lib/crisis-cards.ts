/**
 * Crisis-card content loader (PRD §4.1, §15). One canonical version of each card,
 * bundled from the signed content pack (content/crisis-cards/cards.json) so cards
 * render fully offline with no network. Until a counsel/medic-signed pack replaces
 * the draft, crisisCardsSigned() is false and the renderer shows the draft banner.
 */
import pack from '../../../../content/crisis-cards/cards.json';
import { getLocale } from '$lib/paraglide/runtime';

export type CardSlug = 'teargas' | 'detained' | 'blackout' | 'peaceful' | 'rights';

export interface CardContent {
	title: string;
	steps: string[];
	donts: string[];
	closing: string;
}

interface Pack {
	review_state: string;
	cards: Record<string, { en: CardContent; hi: CardContent }>;
}

const P = pack as Pack;

export function crisisCard(slug: CardSlug): CardContent | null {
	const c = P.cards[slug];
	if (!c) return null;
	return getLocale() === 'hi' ? c.hi : c.en;
}

/** True only once a counsel/medic-signed pack replaces the bundled draft. */
export function crisisCardsSigned(): boolean {
	return P.review_state === 'signed';
}
