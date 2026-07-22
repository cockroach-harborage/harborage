import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

const CARDS = ['teargas', 'detained', 'blackout', 'peaceful', 'rights'] as const;
export type CardSlug = (typeof CARDS)[number];

export const load: PageLoad = ({ params }) => {
	if (!CARDS.includes(params.card as CardSlug)) error(404);
	return { card: params.card as CardSlug };
};
