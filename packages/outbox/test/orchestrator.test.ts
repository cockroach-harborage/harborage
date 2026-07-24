import { describe, expect, it } from 'vitest';
import { OutboxOrchestrator } from '../src/orchestrator.ts';
import type { CipherSource, OutboxItem, OutboxStore } from '../src/types.ts';

function makeItem(): OutboxItem {
	return {
		id: 'itm-1',
		state: 'queued',
		derivative: { sha256: 'd', size: 10, mime: 'image/webp', uploaded: false },
		original: { sha256: 'o', size: 40, mime: 'image/jpeg' },
		originalStatus: 'on_device_only',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: 0,
		maxAge: 1
	};
}

function memStore(): OutboxStore {
	const rows = new Map<string, OutboxItem>();
	return {
		get: async (id) => rows.get(id),
		put: async (item) => void rows.set(item.id, structuredClone(item)),
		delete: async (id) => void rows.delete(id),
		list: async () => [...rows.values()],
		wipeAll: async () => rows.clear()
	};
}

const emptyCipher: CipherSource = { size: 0, slice: async () => new Uint8Array(0) };

describe('outbox orchestrator phase ordering', () => {
	it('runs register -> derivative -> vault, in order', async () => {
		const calls: string[] = [];
		const store = memStore();
		const item = makeItem();
		await store.put(item);
		const orch = new OutboxOrchestrator(
			store,
			{
				register: async () => {
					calls.push('register');
					return 'rcpt';
				}
			},
			{
				uploadDerivative: async () => {
					calls.push('derivative');
				}
			},
			{
				step: async (it) => {
					calls.push('vault');
					it.state = 'done';
					it.originalStatus = 'vaulted';
					await store.put(it);
					return { item: it };
				}
			},
			{ getCipher: async () => emptyCipher }
		);
		const out = await orch.advance(item);
		expect(calls).toEqual(['register', 'derivative', 'vault']);
		expect(out.incidentReceipt).toBe('rcpt');
		expect(out.derivative.uploaded).toBe(true);
	});

	it('does not start derivative or vault if register fails', async () => {
		const calls: string[] = [];
		const orch = new OutboxOrchestrator(
			memStore(),
			{
				register: async () => {
					calls.push('register');
					throw new Error('offline');
				}
			},
			{
				uploadDerivative: async () => {
					calls.push('derivative');
				}
			},
			{
				step: async (it) => {
					calls.push('vault');
					return { item: it };
				}
			},
			{ getCipher: async () => emptyCipher }
		);
		await expect(orch.advance(makeItem())).rejects.toThrow('offline');
		expect(calls).toEqual(['register']);
	});

	it('resumes at the vault phase when register + derivative already done', async () => {
		const calls: string[] = [];
		const item = makeItem();
		item.incidentReceipt = 'rcpt';
		item.derivative.uploaded = true;
		item.state = 'derivative_sent';
		const orch = new OutboxOrchestrator(
			memStore(),
			{
				register: async () => {
					calls.push('register');
					return 'x';
				}
			},
			{
				uploadDerivative: async () => {
					calls.push('derivative');
				}
			},
			{
				step: async (it) => {
					calls.push('vault');
					return { item: it };
				}
			},
			{ getCipher: async () => emptyCipher }
		);
		await orch.advance(item);
		expect(calls).toEqual(['vault']);
	});
});
