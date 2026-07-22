import { describe, expect, it } from 'vitest';
import { featureAvailable, flagEnabled } from '../src/flags.ts';

function kvWith(store: Record<string, string>): KVNamespace {
	return {
		get: async (key: string) => store[key] ?? null
	} as unknown as KVNamespace;
}

function kvThrowing(): KVNamespace {
	return {
		get: async () => {
			throw new Error('kv unreachable');
		}
	} as unknown as KVNamespace;
}

describe('flagEnabled (fail closed)', () => {
	it('is off when the flag is absent', async () => {
		expect(await flagEnabled(kvWith({}), 'record_intake')).toBe(false);
	});

	it('is off when the record is malformed', async () => {
		expect(await flagEnabled(kvWith({ 'flag:record_intake': 'not json' }), 'record_intake')).toBe(
			false
		);
		expect(await flagEnabled(kvWith({ 'flag:record_intake': '{}' }), 'record_intake')).toBe(false);
		expect(
			await flagEnabled(kvWith({ 'flag:record_intake': '{"enabled":"yes"}' }), 'record_intake')
		).toBe(false);
	});

	it('is off when KV is unreachable', async () => {
		expect(await flagEnabled(kvThrowing(), 'record_intake')).toBe(false);
	});

	it('is on only for enabled === true', async () => {
		expect(
			await flagEnabled(
				kvWith({ 'flag:record_intake': '{"enabled":true,"epoch":1,"updatedAt":"x"}' }),
				'record_intake'
			)
		).toBe(true);
	});
});

describe('featureAvailable (heightened threat tightens only)', () => {
	const on = '{"enabled":true,"epoch":1,"updatedAt":"x"}';

	it('requires the feature flag itself', async () => {
		expect(
			await featureAvailable(kvWith({}), 'record_intake', { disabledUnderHeightenedThreat: true })
		).toBe(false);
	});

	it('heightened threat disables a restricted feature', async () => {
		const kv = kvWith({ 'flag:record_intake': on, 'flag:heightened_threat': on });
		expect(
			await featureAvailable(kv, 'record_intake', { disabledUnderHeightenedThreat: true })
		).toBe(false);
		expect(
			await featureAvailable(kv, 'record_intake', { disabledUnderHeightenedThreat: false })
		).toBe(true);
	});
});
