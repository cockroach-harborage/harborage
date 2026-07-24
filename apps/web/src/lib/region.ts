/**
 * India state / UT names for `region_bucket` codes (ISO 3166-2:IN), e.g. IN-DL,
 * IN-PB-LDH. Bounded official list — not free content. Hindi region names are a
 * later refinement; English name with a code fallback for now.
 */
export const INDIA_STATES: Record<string, string> = {
	'IN-AP': 'Andhra Pradesh',
	'IN-AR': 'Arunachal Pradesh',
	'IN-AS': 'Assam',
	'IN-BR': 'Bihar',
	'IN-CT': 'Chhattisgarh',
	'IN-GA': 'Goa',
	'IN-GJ': 'Gujarat',
	'IN-HR': 'Haryana',
	'IN-HP': 'Himachal Pradesh',
	'IN-JH': 'Jharkhand',
	'IN-KA': 'Karnataka',
	'IN-KL': 'Kerala',
	'IN-MP': 'Madhya Pradesh',
	'IN-MH': 'Maharashtra',
	'IN-MN': 'Manipur',
	'IN-ML': 'Meghalaya',
	'IN-MZ': 'Mizoram',
	'IN-NL': 'Nagaland',
	'IN-OR': 'Odisha',
	'IN-PB': 'Punjab',
	'IN-RJ': 'Rajasthan',
	'IN-SK': 'Sikkim',
	'IN-TN': 'Tamil Nadu',
	'IN-TG': 'Telangana',
	'IN-TR': 'Tripura',
	'IN-UP': 'Uttar Pradesh',
	'IN-UT': 'Uttarakhand',
	'IN-WB': 'West Bengal',
	'IN-AN': 'Andaman & Nicobar',
	'IN-CH': 'Chandigarh',
	'IN-DH': 'Dadra & Nagar Haveli and Daman & Diu',
	'IN-DL': 'Delhi',
	'IN-JK': 'Jammu & Kashmir',
	'IN-LA': 'Ladakh',
	'IN-LD': 'Lakshadweep',
	'IN-PY': 'Puducherry'
};

/** The IN-XX state prefix of a region code. */
export function regionState(code: string): string {
	const parts = code.split('-');
	return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : code;
}

/** Human label for a region code: state name, plus any finer segment. */
export function regionLabel(code: string): string {
	const state = INDIA_STATES[regionState(code)];
	if (!state) return code;
	const parts = code.split('-');
	return parts.length > 2 ? `${state} · ${parts.slice(2).join('-')}` : state;
}
