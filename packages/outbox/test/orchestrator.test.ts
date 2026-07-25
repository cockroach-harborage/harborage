import { describe, expect, it, vi } from 'vitest';
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

function noteItem(): OutboxItem {
	return {
		id: 'note-1',
		state: 'queued',
		derivative: { sha256: '', size: 0, mime: '', uploaded: false },
		original: { sha256: '', size: 0, mime: '' },
		originalStatus: 'none',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: 0,
		maxAge: 0
	};
}

describe('an item with no pristine original', () => {
	/**
	 * A written note has nothing to vault. It used to be labelled `vaulted` --
	 * the strongest custody claim in the vocabulary -- and §19:1261 makes that
	 * exact field load-bearing in legal exports, so the export layer would have
	 * repeated the claim that a note was evidence-backed.
	 */
	it('finishes after register and never starts a vault upload', async () => {
		const store = memStore();
		const step = vi.fn(async (item: OutboxItem) => ({ item }));
		const orchestrator = new OutboxOrchestrator(
			store,
			{ register: async () => 'receipt-1' },
			{ uploadDerivative: async () => {} },
			{ step },
			{ getCipher: async () => ({ size: 0, slice: async () => new Uint8Array(0) }) as CipherSource }
		);

		const item = noteItem();
		const out = await orchestrator.advance(item);

		expect(step).not.toHaveBeenCalled();
		expect(out.state).toBe('done');
		expect(out.originalStatus).toBe('none');
		expect(out.incidentReceipt).toBe('receipt-1');
		// And it was persisted, so a reload does not re-register it.
		expect((await store.get(item.id))?.incidentReceipt).toBe('receipt-1');
	});
});
