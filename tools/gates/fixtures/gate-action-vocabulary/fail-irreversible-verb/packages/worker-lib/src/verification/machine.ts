export const ACTIONS = [
	'label',
	'rank',
	'hide-pending',
	'retain-pending',
	'route-to-gate'
] as const;

function publishItem(id: string): string {
	return id;
}

export function decide(id: string): string {
	return publishItem(id);
}
