import { describe, expect, it } from 'vitest';
import { deriveJitterMs, publishable, type PublishInput } from '../src/liveboard/publish.ts';
import {
	CORROBORATION_K,
	DENSITY_FLOOR_D,
	PUBLICATION_DELAY_BASE_MS,
	PUBLICATION_JITTER_MAX_MS
} from '../src/liveboard/params.ts';
import { SIGNAL_TYPES, type SignalType } from '../src/liveboard/types.ts';

const T0 = 1_785_000_000_000;

function input(over: Partial<PublishInput> = {}): PublishInput {
	return {
		nowMs: T0 + PUBLICATION_DELAY_BASE_MS + 1,
		firstSeenMs: T0,
		jitterMs: 0,
		densityLcb: DENSITY_FLOOR_D,
		signalLcb: CORROBORATION_K,
		signal: 'TEAR_GAS',
		marshalValid: false,
		heightened: false,
		...over
	};
}

describe('suppress-until-safe-density', () => {
	it('withholds below the floor and shows at it', () => {
		expect(publishable(input({ densityLcb: DENSITY_FLOOR_D - 1 })).show).toBe(false);
		expect(publishable(input({ densityLcb: DENSITY_FLOOR_D })).show).toBe(true);
	});

	it('withholds a lone reporter however long ago they reported', () => {
		expect(publishable(input({ densityLcb: 1, signalLcb: 1, nowMs: T0 + 86_400_000 })).show).toBe(
			false
		);
	});
});

describe('the publication delay', () => {
	it('withholds until base plus jitter has elapsed', () => {
		const jitterMs = 30_000;
		const due = T0 + PUBLICATION_DELAY_BASE_MS + jitterMs;
		expect(publishable(input({ jitterMs, nowMs: due - 1 })).show).toBe(false);
		expect(publishable(input({ jitterMs, nowMs: due })).show).toBe(true);
	});

	/**
	 * The delay is measured against the SERVER's first-seen. A client-asserted
	 * time would hand the client control of the publication delay, and shortening
	 * that delay is precisely the attack the delay defends against. There is no
	 * client-supplied field in PublishInput at all, so this asserts the shape.
	 */
	it('takes no client-supplied time', () => {
		const keys = Object.keys(input());
		expect(keys).not.toContain('reportedAtMs');
		expect(keys).not.toContain('clientTimeMs');
	});
});

describe('SAFE_EXIT and DISPERSAL are withheld without a quorum', () => {
	/**
	 * §6.3: a community version without quorum is WITHHELD, not shown with lower
	 * confidence. A wrong SAFE_EXIT walks people into a kettle.
	 *
	 * The assertion is on ABSENCE, not on a confidence field, because a test
	 * asserting `marshal_verified === false` would describe a greyed signal, which
	 * is the forbidden thing rather than the correct one.
	 */
	it('withholds entirely, rather than showing with a caveat', () => {
		for (const signal of ['SAFE_EXIT', 'DISPERSAL'] as SignalType[]) {
			const v = publishable(input({ signal, marshalValid: false }));
			expect(v.show, signal).toBe(false);
			// There is no third state to fall into: the verdict has two booleans.
			expect(Object.keys(v).sort()).toEqual(['corroborated', 'show']);
		}
	});

	it('shows once a quorum is present', () => {
		for (const signal of ['SAFE_EXIT', 'DISPERSAL'] as SignalType[]) {
			expect(publishable(input({ signal, marshalValid: true })).show, signal).toBe(true);
		}
	});

	it('does not demand a quorum of an ordinary hazard', () => {
		for (const signal of SIGNAL_TYPES) {
			if (signal === 'SAFE_EXIT' || signal === 'DISPERSAL') continue;
			expect(publishable(input({ signal, marshalValid: false })).show, signal).toBe(true);
		}
	});
});

describe('corroboration is a flag, never a number', () => {
	it('reports corroborated only at or above the bar', () => {
		expect(publishable(input({ signalLcb: CORROBORATION_K - 1 })).corroborated).toBe(false);
		expect(publishable(input({ signalLcb: CORROBORATION_K })).corroborated).toBe(true);
	});

	it('returns nothing a caller could render as a count', () => {
		const v = publishable(input({ signalLcb: 47 }));
		for (const value of Object.values(v)) expect(typeof value).toBe('boolean');
	});
});

describe('heightened threat tightens and never loosens', () => {
	it('raises the floor, raises the bar, and lengthens the delay', () => {
		const base = input({ densityLcb: DENSITY_FLOOR_D, nowMs: T0 + PUBLICATION_DELAY_BASE_MS + 1 });
		expect(publishable(base).show).toBe(true);
		expect(publishable({ ...base, heightened: true }).show).toBe(false);

		// A much later read, so only the raised thresholds can still withhold it.
		const late = { ...base, nowMs: T0 + 3_600_000, heightened: true };
		expect(publishable({ ...late, densityLcb: DENSITY_FLOOR_D }).show).toBe(false);
		expect(publishable({ ...late, densityLcb: DENSITY_FLOOR_D + 3 }).show).toBe(true);
		expect(publishable({ ...late, densityLcb: 99, signalLcb: CORROBORATION_K }).corroborated).toBe(
			false
		);
		expect(
			publishable({ ...late, densityLcb: 99, signalLcb: CORROBORATION_K + 2 }).corroborated
		).toBe(true);
	});

	/** Never the other way: no input combination makes heightened show MORE. */
	it('never shows something the ordinary posture would withhold', () => {
		for (let d = 0; d < 20; d++) {
			for (let k = 0; k < 8; k++) {
				const ordinary = publishable(input({ densityLcb: d, signalLcb: k }));
				const tight = publishable(input({ densityLcb: d, signalLcb: k, heightened: true }));
				if (tight.show) expect(ordinary.show, `d=${d} k=${k}`).toBe(true);
				if (tight.corroborated) expect(ordinary.corroborated, `d=${d} k=${k}`).toBe(true);
			}
		}
	});
});

describe('deriveJitterMs is stable within an epoch', () => {
	const salt = new Uint8Array(32).fill(11);

	/**
	 * THE TEST A NAIVE SUITE WOULD NOT WRITE. Calling the predicate once always
	 * sees a consistent answer, so a per-read roll passes every other test here.
	 * With a fresh roll each read, a client polling twice a second watches the
	 * signal blink and pins the true report time to within one poll, and the whole
	 * delay becomes theatre.
	 */
	it('returns the same value for the same zone, signal and epoch', async () => {
		const a = await deriveJitterMs(salt, 'IN-DL-z0417', 'TEAR_GAS', 7);
		for (let i = 0; i < 20; i++) {
			expect(await deriveJitterMs(salt, 'IN-DL-z0417', 'TEAR_GAS', 7)).toBe(a);
		}
	});

	it('differs by zone, by signal, and by epoch', async () => {
		const base = await deriveJitterMs(salt, 'IN-DL-z0417', 'TEAR_GAS', 7);
		expect(await deriveJitterMs(salt, 'IN-DL-z0418', 'TEAR_GAS', 7)).not.toBe(base);
		expect(await deriveJitterMs(salt, 'IN-DL-z0417', 'ROAD_BLOCK', 7)).not.toBe(base);
		expect(await deriveJitterMs(salt, 'IN-DL-z0417', 'TEAR_GAS', 8)).not.toBe(base);
	});

	it('changes when the epoch salt rotates', async () => {
		const other = new Uint8Array(32).fill(22);
		expect(await deriveJitterMs(other, 'IN-DL-z0417', 'TEAR_GAS', 7)).not.toBe(
			await deriveJitterMs(salt, 'IN-DL-z0417', 'TEAR_GAS', 7)
		);
	});

	it('stays inside the configured range', async () => {
		for (let i = 0; i < 200; i++) {
			const j = await deriveJitterMs(salt, `IN-DL-z${i}`, 'TEAR_GAS', 1);
			expect(j).toBeGreaterThanOrEqual(0);
			expect(j).toBeLessThanOrEqual(PUBLICATION_JITTER_MAX_MS);
		}
	});
});
