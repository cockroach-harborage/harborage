/**
 * Frozen incident-type taxonomy (PRD §2; two-person reviewed, EN+HI).
 * A closed set of neutral, plain-language categories. The KEY is stored on the
 * incident record; labels are i18n and render client-side. Severe categories
 * (sexual violence, death, custody abuse, disappearance) still obey every
 * redaction/PII rule and route individual-identity content to the counsel-gated
 * accountability path — the category label itself is public-safe.
 *
 * Delivered today as this typed module + message strings; the signed
 * `content/taxonomy` pack is the future update channel (PRD §14 item 3).
 */
import { m } from '$lib/paraglide/messages.js';

export const INCIDENT_TYPES = [
	'baton_charge',
	'crowd_weapons',
	'firing',
	'assault',
	'sexual_violence',
	'detention',
	'custody_abuse',
	'death',
	'denied_care',
	'incommunicado',
	'surveillance',
	'network_shutdown',
	'property_damage',
	'intimidation'
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

const LABELS: Record<IncidentType, () => string> = {
	baton_charge: m.inc_type_baton_charge,
	crowd_weapons: m.inc_type_crowd_weapons,
	firing: m.inc_type_firing,
	assault: m.inc_type_assault,
	sexual_violence: m.inc_type_sexual_violence,
	detention: m.inc_type_detention,
	custody_abuse: m.inc_type_custody_abuse,
	death: m.inc_type_death,
	denied_care: m.inc_type_denied_care,
	incommunicado: m.inc_type_incommunicado,
	surveillance: m.inc_type_surveillance,
	network_shutdown: m.inc_type_network_shutdown,
	property_damage: m.inc_type_property_damage,
	intimidation: m.inc_type_intimidation
};

export function isIncidentType(s: string): s is IncidentType {
	return (INCIDENT_TYPES as readonly string[]).includes(s);
}

export function incidentTypeLabel(t: IncidentType): string {
	return LABELS[t]();
}
