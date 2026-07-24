/**
 * Turnstile siteverify (ARCHITECTURE §17.5). Tuned to admit Tor/VPN at the widget
 * level; here we only confirm the token. Fails CLOSED: a missing token or secret,
 * or any error, returns false. The secret is unset until intake switch-on, so at
 * M1 this always fails closed — which is correct while record_intake is OFF.
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
		const data = (await res.json()) as { success?: boolean };
		return data.success === true;
	} catch {
		return false;
	}
}
