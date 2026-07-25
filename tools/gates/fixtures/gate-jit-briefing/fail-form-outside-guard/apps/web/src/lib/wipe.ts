import { forgetBriefing } from '$lib/briefing.svelte';

export async function wipeDevice(): Promise<void> {
	forgetBriefing();
}
