/**
 * Fail-closed Cloudflare Access JWT verification for the privileged console
 * (ARCHITECTURE §17.2). There is no bypass code path, by design — local dev
 * uses a mock issuer via ACCESS_TEAM_DOMAIN/ACCESS_AUD dev values, never a
 * skip. Any error, missing header, or missing config denies.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AccessIdentity {
	/** Access subject — a stable opaque per-identity id. */
	sub: string;
	/** IdP email claim; staff handles only, treated as a compellable roster. */
	email: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccess(
	request: Request,
	env: { ACCESS_AUD: string; ACCESS_TEAM_DOMAIN: string }
): Promise<AccessIdentity | null> {
	try {
		if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return null;
		const token = request.headers.get('Cf-Access-Jwt-Assertion');
		if (!token) return null;

		const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
		let jwks = jwksCache.get(issuer);
		if (!jwks) {
			jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
			jwksCache.set(issuer, jwks);
		}
		const { payload } = await jwtVerify(token, jwks, {
			issuer,
			audience: env.ACCESS_AUD
		});
		if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
		const email = typeof payload.email === 'string' ? payload.email : '';
		if (!email) return null;
		return { sub: payload.sub, email };
	} catch {
		return null; // fail closed
	}
}
