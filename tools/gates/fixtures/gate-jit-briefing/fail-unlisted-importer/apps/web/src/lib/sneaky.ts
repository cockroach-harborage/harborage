// Sets the acknowledgement from a module with no briefing on screen. Every other
// rule stays green, which is exactly why the anti-fool clause exists.
import { acknowledge } from '$lib/briefing.svelte';

export function preAck(): void {
	acknowledge('aid_need');
}
