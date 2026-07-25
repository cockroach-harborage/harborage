// PASS fixture. Three lists, disjoint where they must be, covering active
// exactly. The gate parses these literals, so the shapes matter.
export const COMPARTMENTS = ['document', 'directory', 'medical', 'aid'] as const;
export type Compartment = (typeof COMPARTMENTS)[number];

export const ACTIVE_COMPARTMENTS: readonly Compartment[] = [
	'document',
	'directory',
	'medical',
	'aid'
];
export const CACHED_COMPARTMENTS: readonly Compartment[] = ['document', 'directory'];
export const ONE_SHOT_ONLY_COMPARTMENTS: readonly Compartment[] = ['medical'];
