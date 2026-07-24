/**
 * Turnstile siteverify (ARCHITECTURE §17.5). Here we only confirm the token.
 * Fails CLOSED: a missing token or secret, or any error, returns false. The
 * secret is unset until intake switch-on, so this always fails closed today —
 * which is correct while intake is OFF.
 *
 * We read ONLY `success`. The siteverify response also carries a `metadata`
 * object whose `ephemeral_id` is a Cloudflare cross-request visitor correlator;
 * reading, persisting, or logging it on a protestor path would build a
 * device-linked pseudo-roster the invariants forbid. It is never touched here.
 *
 * HONEST CORRECTION (verified against live Cloudflare docs, 2026-07-25): there is
 * no "tuned to admit Tor/VPN" setting. No such control is documented, and the
 * official guidance points the other way. Do not claim it. What actually helps a
 * Tor or VPN user is a widget-side choice, so when the widget lands it MUST use:
 *
 *   - Managed mode, never Invisible. An Invisible widget gives a blocked Tor user
 *     no interaction and therefore no recovery path.
 *   - Pre-clearance, so one solve exempts subsequent challenges on the same path.
 *   - `feedback-enabled: false`. It defaults to TRUE and reports visitor feedback
 *     to Cloudflare on widget failure — telemetry we must not emit on a
 *     protestor surface.
 *
 * Personhood-lite is layered, never sufficient alone: commercial solver farms
 * defeat it cheaply, which is exactly why the autonomous trust ceiling stays low.
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
	token: string | undefined,
	secret: string | undefined
): Promise<boolean> {
	if (!token || !secret) return false;
	try {
		const form = new FormData();
		form.append('secret', secret);
		form.append('response', token);
		const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
		if (!res.ok) return false;
		// Destructure `success` only; the rest of the body (incl. metadata) is dropped.
		const { success } = (await res.json()) as { success?: boolean };
		return success === true;
	} catch {
		return false;
	}
}
