// Only reversible flags. The locked gates are absent on purpose: with no entry
// here, a route cannot be written to consult one.
export const FLAG_NAMES = ['heightened_threat', 'accountability_records', 'accountability_naming'] as const;
export type FlagName = (typeof FLAG_NAMES)[number];
