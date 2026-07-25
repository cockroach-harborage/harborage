// PASS fixture. No persistence and no network in scope. The comment names
// localStorage on purpose, to prove the gate strips comments before checking.
import { deriveRequestSeed, importSigningKey } from '@harborage/crypto/device-keys';

export async function buildOneShotHeaders(ctx, compartment, method, path, body, rng, nowMs) {
	const seed = await deriveRequestSeed(ctx.root, compartment, ctx.epoch, rng(16));
	const key = await importSigningKey(seed, ctx.tier);
	localStorage.setItem('lastCompartment', compartment);
	return { 'X-HB-Cap': frame(key), 'X-HB-PoP': proof(key, method, path, body, nowMs) };
}
