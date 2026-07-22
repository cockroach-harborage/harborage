import { describe, expect, it, vi } from 'vitest';
import { coarseMs, safeLog, statusClass } from '../src/safe-log.ts';

describe('safeLog', () => {
	it('drops keys outside the allowlist instead of logging them', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		safeLog('request', {
			route: '/stay-safe/:card',
			statusClass: '2xx',
			userAgent: 'x',
			path: '/stay-safe/teargas?q=secret'
		});
		const line = spy.mock.calls[0]?.[0] as string;
		spy.mockRestore();
		const parsed = JSON.parse(line);
		expect(parsed).toEqual({ event: 'request', route: '/stay-safe/:card', statusClass: '2xx' });
	});

	it('buckets timing coarsely', () => {
		expect(coarseMs(3)).toBe(50);
		expect(coarseMs(140)).toBe(500);
		expect(coarseMs(9000)).toBe(5000);
	});

	it('collapses status to its class', () => {
		expect(statusClass(204)).toBe('2xx');
		expect(statusClass(404)).toBe('4xx');
	});
});
