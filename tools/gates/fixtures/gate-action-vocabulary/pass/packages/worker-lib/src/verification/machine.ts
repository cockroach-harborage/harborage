export const ACTIONS = [
	'label',
	'rank',
	'hide-pending',
	'retain-pending',
	'route-to-gate'
] as const;

export function decide(): string {
	return 'label';
}
