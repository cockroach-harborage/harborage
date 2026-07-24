/**
 * Directory category taxonomy (PRD §14 item 3), mapped to the resource_entries
 * `category` enum. Organizations / already-public resources only — never a
 * person. Labels are i18n; the key is stored on the row.
 */
import { m } from '$lib/paraglide/messages.js';

export const DIR_CATEGORIES = [
	{ key: 'MENTAL_HEALTH', label: m.dir_mental },
	{ key: 'LEGAL_AID', label: m.dir_legal },
	{ key: 'MEDICAL', label: m.dir_medical },
	{ key: 'SAFE_SPACE', label: m.dir_safe },
	{ key: 'JOURNALIST_INTAKE', label: m.dir_journalists },
	{ key: 'HUMAN_RIGHTS_ORG', label: m.dir_rights_orgs },
	{ key: 'COMMUNITY', label: m.dir_food },
	{ key: 'FINANCIAL_RELIEF', label: m.dir_relief },
	{ key: 'DISABILITY_INCLUSIVE', label: m.dir_disability },
	{ key: 'FACILITY', label: m.dir_facility },
	{ key: 'EMERGENCY_CONTACT', label: m.dir_emergency }
] as const;

export type DirCategory = (typeof DIR_CATEGORIES)[number]['key'];

export function dirCategoryLabel(key: string): string {
	return DIR_CATEGORIES.find((c) => c.key === key)?.label() ?? key;
}

/** Parse the languages JSON array field, tolerant of malformed data. */
export function parseLanguages(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
	} catch {
		return [];
	}
}
