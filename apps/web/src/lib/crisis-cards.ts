/**
 * Crisis-card content loader (PRD §4.1, §15). Content comes from the signed
 * knowledge pack (built by tools/pack from content/crisis-cards/cards.json), so
 * the same bytes render offline and can be peer-shared and signature-verified.
 *
 * "Signed" is a cryptographic fact — a minisign signature over the exact pack
 * bytes, verified against the pinned project key (content-pack.ts) — never the
 * self-asserted review_state field. Until the offline key ceremony pins a key
 * and a signed pack ships (RUNBOOK), crisisCardsSigned() is false and the
 * renderer shows the draft banner.
 */
import packRaw from '../../static/packs/crisis-cards-v1.harborage-pack?raw';
import { parsePack, verifyContentPack } from '$lib/content-pack';
import { getLocale } from '$lib/paraglide/runtime';

export type CardSlug = 'teargas' | 'detained' | 'blackout' | 'peaceful' | 'rights';

export interface CardContent {
	title: string;
	steps: string[];
	donts: string[];
	closing: string;
}

interface CardsFile {
	cards: Record<string, { en: CardContent; hi: CardContent }>;
}

/**
 * The detached signature over the committed pack, dropped in after the offline
 * key ceremony (RUNBOOK). Empty until then, so verify fails closed and the draft
 * banner shows.
 */
const CRISIS_PACK_SIGNATURE = '';

const PACK_BYTES = new TextEncoder().encode(packRaw);
const pack = parsePack(PACK_BYTES);
const cardsFile = pack?.files['crisis-cards/cards.json'] as CardsFile | undefined;

export function crisisCard(slug: CardSlug): CardContent | null {
	const c = cardsFile?.cards[slug];
	if (!c) return null;
	return getLocale() === 'hi' ? c.hi : c.en;
}

/** True only once a minisign signature over the pack verifies against a pinned key. */
export function crisisCardsSigned(): boolean {
	return verifyContentPack(PACK_BYTES, CRISIS_PACK_SIGNATURE);
}
