/**
 * LiveBoard DO — one per zone (ARCHITECTURE §6; PRD §4.5).
 *
 * WHOLLY MEMORY-ONLY (gate-memory-only). No durable store of any kind, no D1,
 * no bucket, no WebSocket attachment, and NO ALARM: setting one reaches the same
 * durable interface the gate forbids, it bills as a row written, and the row is
 * a PITR-visible record that something is pending at time T. (Described rather
 * than named, because the gate scans comments.)
 *
 * NO WEBSOCKETS EITHER, and the reason is not the gate. Per-socket zone state
 * would fit in hibernation tags, which are not barred. The problem is arithmetic:
 * an idle non-hibernatable Durable Object is evicted after 70 to 140 seconds,
 * while §6.4 mandates a publication delay of 60 to 180 seconds. THOSE OVERLAP. A
 * hazard signal can be destroyed before it is publishable, which is a
 * life-safety read going dark and §6.5 forbids it outright. That is a property
 * of memory-only plus a mandated delay and is present with hibernation OFF, so
 * anyone who "fixes" it by adding long-lived sockets has fixed nothing.
 *
 * What actually keeps the instance resident is the reporters' own heartbeats
 * plus a reader's in-flight long poll. The client re-posts every 45 seconds
 * while its tab is visible, which is inside the 70-second floor, and the re-post
 * is IDEMPOTENT for free: same credential, same epoch, same dedup token, and the
 * sketch insert is a no-op. The heartbeat is simultaneously the durability
 * mechanism, the clock, and the keep-alive.
 *
 * HONEST FAILURE MODES, which belong in the product copy and not only here:
 *   - Heartbeats stop when the app is backgrounded, so a signal lapses about a
 *     minute after the last reporter pockets their phone. THIS BOARD WORKS WHILE
 *     PEOPLE ARE LOOKING AT IT. It is not live monitoring.
 *   - If every reporter drops for more than the eviction window, the delay clock
 *     restarts and publication is LATER, never earlier.
 *   - After eviction the board returns empty, and empty is indistinguishable
 *     from "no hazards". `rebuilding` is true for a window afterwards so the
 *     client keeps its cached rows with a STALE badge instead of flashing to
 *     nothing.
 */
import { DurableObject } from 'cloudflare:workers';
import {
	BANDS,
	DEDUP_EPOCH_MS,
	deriveJitterMs,
	insert,
	lowerBound,
	nextBand,
	newSketch,
	occupied,
	publishable,
	REBUILD_TICKS,
	requiresQuorum,
	SIGNAL_TTL_MS,
	targetBand,
	TICK_MS,
	upperBound,
	type Band,
	type BoardSignal,
	type BoardView,
	type SignalType
} from '@harborage/worker-lib/liveboard';

/**
 * How long the previous epoch's salt and sketch stay alive after rotation.
 *
 * WITHOUT AN OVERLAP THE FLOOR IS RE-EARNED EVERY EPOCH, so a publishing zone
 * goes dark at every fifteen-minute boundary and strobes back a minute later.
 * The overlap takes max(current, previous), never the sum: summing would
 * double-count a reporter who reported on both sides of the boundary, and
 * inflation is the direction that pushes a small group over the floor.
 */
const EPOCH_OVERLAP_MS = 90_000;

/** Longest a reader's poll is held open. */
const MAX_WAIT_MS = 25_000;

interface SignalState {
	/** When the SERVER first saw it. Never a client-asserted time. */
	firstSeenMs: number;
	jitterMs: number;
	marshalValid: boolean;
	sketch: Uint8Array;
	prevSketch: Uint8Array | null;
}

interface Waiter {
	resolve(view: BoardView): void;
	timer: ReturnType<typeof setTimeout>;
}

export class LiveBoard extends DurableObject {
	private zoneId = '';
	private epochIndex = -1;
	private salt = new Uint8Array(32);
	private prevSalt: Uint8Array | null = null;

	private density = newSketch();
	private prevDensity: Uint8Array | null = null;
	private signals = new Map<SignalType, SignalState>();

	private band: Band = 'none';
	private ticksAtOrAboveTarget = 0;
	private lastBandTick = -1;

	private waiters: Waiter[] = [];
	private readonly bornMs = Date.now();

	/**
	 * Record one report.
	 *
	 * RETURNS THE STRING 'accepted', ALWAYS, AND NOTHING ELSE. This is the single
	 * easiest way to destroy suppress-until-safe-density: if the return value
	 * revealed whether the signal crossed the floor, whether the token was a
	 * duplicate, or how many reporters there are, an attacker reporting once a
	 * second from N credentials would binary-search the true count straight out
	 * of it. The only channel a reporter has to learn board state is the same
	 * public view() everyone gets, delayed and floored.
	 */
	async report(input: {
		zoneId: string;
		signal: SignalType;
		/**
		 * The requesting credential's certificate hash, hex.
		 *
		 * THE ROUTE PASSES THIS, NOT A TOKEN. An earlier version had the caller
		 * compute HMAC(salt, certHashHex), which meant handing the route the epoch
		 * salt — and the salt is the ONE thing that makes the sketch more than a
		 * reversible index. Anyone holding it and a candidate credential can test
		 * that credential's register, so it must never leave this instance. The
		 * derivation moved inside.
		 *
		 * certHashHex rather than a client-supplied seed, because a client that
		 * chose its own seed could mint unlimited apparent reporters with a fresh
		 * value per heartbeat and defeat the density floor and the corroboration
		 * bar entirely. §6.3 says `reporter_session`; this is the correction.
		 */
		certHashHex: string;
		marshalValid?: boolean;
		nowMs?: number;
	}): Promise<'accepted'> {
		const nowMs = input.nowMs ?? Date.now();
		this.zoneId = input.zoneId;
		await this.rotateIfDue(nowMs);
		this.expire(nowMs);

		const dedupToken = await this.dedupToken(input.certHashHex);
		insert(this.density, dedupToken);

		let state = this.signals.get(input.signal);
		if (!state) {
			state = {
				firstSeenMs: nowMs,
				jitterMs: await deriveJitterMs(this.salt, input.zoneId, input.signal, this.epochIndex),
				marshalValid: false,
				sketch: newSketch(),
				prevSketch: null
			};
			this.signals.set(input.signal, state);
		}
		insert(state.sketch, dedupToken);
		// A quorum, once verified by the ingest route, is sticky for the life of
		// the signal. It is never un-set by a later unquorumed report, because that
		// would let one unsigned report suppress a marshal-attested SAFE_EXIT.
		if (input.marshalValid) state.marshalValid = true;

		this.wake(nowMs);
		return 'accepted';
	}

	/**
	 * The public view, optionally held open until something changes.
	 *
	 * The in-flight request and its timer are what keep this instance resident
	 * through the publication delay window, which is the whole reason the read
	 * path is a long poll rather than a socket.
	 */
	async view(
		opts: { sinceTick?: number; waitMs?: number; nowMs?: number } = {}
	): Promise<BoardView> {
		const nowMs = opts.nowMs ?? Date.now();
		await this.rotateIfDue(nowMs);
		this.expire(nowMs);

		const current = this.compose(nowMs);
		const waitMs = Math.min(opts.waitMs ?? 0, MAX_WAIT_MS);
		if (waitMs <= 0 || (opts.sinceTick ?? -1) !== current.tick) return current;

		return new Promise<BoardView>((resolve) => {
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((w) => w.timer !== timer);
				resolve(this.compose(Date.now()));
			}, waitMs);
			this.waiters.push({ resolve, timer });
		});
	}

	/**
	 * The density lower bound the floor consumes, current epoch combined with the
	 * overlap.
	 *
	 * ONE COPY, and it is deliberately the only one. compose() and the test
	 * accessor both call it, because they used to each carry their own
	 * `Math.max(...)` and the sabotage that changed one to a SUM left the test
	 * green: the test was reading a different line than the read path used. Same
	 * class of bug gate-geo-granularity check 4 forbids for the density floor
	 * constant, for the same reason.
	 *
	 * max(), never sum: summing would double-count a reporter who reported on both
	 * sides of an epoch boundary, and inflation is the direction that pushes a
	 * small group over the floor.
	 */
	private combinedDensityLcb(): number {
		return Math.max(lowerBound(this.density), this.prevDensityLcb());
	}

	/** Compose what a reader may see. Never a count, never a coordinate. */
	private compose(nowMs: number, heightened = false): BoardView {
		const densityLcb = this.combinedDensityLcb();
		const signals: BoardSignal[] = [];

		for (const [signal, state] of this.signals) {
			const signalLcb = Math.max(
				lowerBound(state.sketch),
				state.prevSketch ? lowerBound(state.prevSketch) : 0
			);
			const verdict = publishable({
				nowMs,
				firstSeenMs: state.firstSeenMs,
				jitterMs: state.jitterMs,
				densityLcb,
				signalLcb,
				signal,
				marshalValid: state.marshalValid,
				heightened
			});
			// WITHHELD MEANS ABSENT. There is no greyed row, because BoardSignal has
			// no field that could carry one.
			if (!verdict.show) continue;
			signals.push({
				signal,
				corroborated: verdict.corroborated,
				marshal_verified: requiresQuorum(signal) ? state.marshalValid : false
			});
		}

		return {
			tick: Math.floor(nowMs / TICK_MS),
			zone_id: this.zoneId,
			rebuilding: nowMs - this.bornMs < REBUILD_TICKS * TICK_MS,
			band: this.currentBand(nowMs, densityLcb, heightened),
			signals
		};
	}

	private currentBand(nowMs: number, densityLcb: number, heightened: boolean): Band | null {
		// §6.4: crowd bands are disabled ENTIRELY under heightened threat, not
		// merely coarsened.
		if (heightened) return null;
		const tick = Math.floor(nowMs / TICK_MS);
		if (tick !== this.lastBandTick) {
			this.ticksAtOrAboveTarget =
				targetBand(densityLcb) === this.band ? 0 : this.ticksAtOrAboveTarget + 1;
			this.band = nextBand(
				this.band,
				densityLcb,
				Math.max(upperBound(this.density), this.prevDensityUcb()),
				this.ticksAtOrAboveTarget
			);
			this.lastBandTick = tick;
		}
		return this.band;
	}

	private prevDensityLcb(): number {
		return this.prevDensity ? lowerBound(this.prevDensity) : 0;
	}

	private prevDensityUcb(): number {
		return this.prevDensity ? upperBound(this.prevDensity) : 0;
	}

	/**
	 * Rotate the dedup salt, and RESET the sketch with it.
	 *
	 * Keeping the sketch across a rotation would double-count a reporter whose new
	 * token lands in a different register, and inflation is the direction that
	 * pushes a small group over the density floor. The previous sketch is kept
	 * for an overlap window and combined with max(), never sum, so the floor is
	 * not re-earned from zero at every boundary.
	 */
	private async rotateIfDue(nowMs: number): Promise<void> {
		const epoch = Math.floor(nowMs / DEDUP_EPOCH_MS);
		if (epoch === this.epochIndex) return;

		// CARRY FORWARD ONLY FROM THE IMMEDIATELY PRECEDING EPOCH.
		//
		// The overlap exists so a continuously-reported zone does not go dark and
		// strobe back at every fifteen-minute boundary. If epochs were SKIPPED,
		// there is no continuity to preserve: nobody reported in between, and the
		// sketch being carried is an hour old. Keeping it would let stale reporters
		// inflate the density floor and publish a group that had long since
		// dispersed, and inflation is the unsafe direction.
		//
		// Two versions of this were wrong before the test caught it: keyed to when
		// rotation was OBSERVED (so a quiet board handed the old sketch a fresh
		// lease on every wake), then keyed to the boundary but still carrying across
		// a four-epoch gap.
		const contiguous = this.epochIndex !== -1 && epoch === this.epochIndex + 1;
		this.prevSalt = contiguous ? this.salt : null;
		this.prevDensity = contiguous ? this.density : null;
		for (const state of this.signals.values()) {
			state.prevSketch = contiguous ? state.sketch : null;
			state.sketch = newSketch();
		}

		this.salt = new Uint8Array(32);
		crypto.getRandomValues(this.salt);
		this.density = newSketch();
		this.epochIndex = epoch;

		// The jitter is derived from the salt, so it moves with the epoch. Rederive
		// once here rather than per read, or the delay becomes a per-poll coin flip
		// and a client polling fast can pin the true report time.
		for (const [signal, state] of this.signals) {
			state.jitterMs = await deriveJitterMs(this.salt, this.zoneId, signal, epoch);
		}
	}

	/**
	 * Lazy expiry, at the top of every method. No alarm exists to do it.
	 *
	 * THE OVERLAP IS MEASURED FROM THE EPOCH BOUNDARY, not from when rotation was
	 * observed, and the difference is a safety bug rather than a nicety. Rotation
	 * is lazy, so on a board nobody touches for an hour it happens on the next
	 * call and `rotatedAtMs` becomes that moment. Keyed to that, the previous
	 * epoch's sketch would get a fresh 90-second lease every time the board woke,
	 * so hour-old reporters would keep inflating the density floor and could
	 * publish a group that had long since dispersed. Inflation is the unsafe
	 * direction. Keyed to the boundary, a long gap drops the old sketch on the
	 * first touch and the overlap only ever helps a genuinely continuous board.
	 */
	private expire(nowMs: number): void {
		const boundaryMs = this.epochIndex * DEDUP_EPOCH_MS;
		if (this.prevDensity && nowMs - boundaryMs > EPOCH_OVERLAP_MS) {
			this.prevDensity = null;
			this.prevSalt = null;
			for (const state of this.signals.values()) state.prevSketch = null;
		}
		for (const [signal, state] of this.signals) {
			if (nowMs - state.firstSeenMs > SIGNAL_TTL_MS) this.signals.delete(signal);
		}
	}

	/** Release every parked reader, so a new report reaches them at once. */
	private wake(nowMs: number): void {
		if (this.waiters.length === 0) return;
		const view = this.compose(nowMs);
		const parked = this.waiters;
		this.waiters = [];
		for (const w of parked) {
			clearTimeout(w.timer);
			w.resolve(view);
		}
	}

	/**
	 * dedup_token = HMAC(per-(zone, epoch) memory salt, certHashHex).
	 *
	 * PRIVATE, and there is deliberately no accessor for the salt. It is the one
	 * thing that makes the sketch more than a reversible index: with it, anyone
	 * holding a candidate credential can compute that credential's register and
	 * test membership. It is generated here, never persisted, never logged, and
	 * never returned.
	 *
	 * HONEST CEILING, and it belongs in the limits copy: one Turnstile-passing
	 * cap-cert is one reporter, so the density floor is exactly as strong as
	 * personhood-lite plus the rate ladder and NO STRONGER. It protects a small
	 * group from a casual observer or an accident. It does not protect them from
	 * an adversary who mints five credentials, which is the same wall §15 already
	 * admits a state can climb.
	 */
	private async dedupToken(certHashHex: string): Promise<Uint8Array> {
		const key = await crypto.subtle.importKey(
			'raw',
			this.salt as BufferSource,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const message = new TextEncoder().encode(certHashHex);
		return new Uint8Array(await crypto.subtle.sign('HMAC', key, message as BufferSource));
	}

	/** Distinct-reporter lower bound, for tests only. Never reachable from a route. */
	async densityForTest(nowMs = Date.now()): Promise<number> {
		await this.rotateIfDue(nowMs);
		this.expire(nowMs);
		return this.combinedDensityLcb();
	}

	/** Occupied registers, for tests only. Never reachable from a route. */
	async occupiedForTest(): Promise<number> {
		return occupied(this.density);
	}

	/** Compose under heightened threat, for the read route. */
	async viewHeightened(nowMs = Date.now()): Promise<BoardView> {
		await this.rotateIfDue(nowMs);
		this.expire(nowMs);
		return this.compose(nowMs, true);
	}

	/** The band vocabulary, so a caller cannot invent one. */
	static get bands(): readonly string[] {
		return BANDS;
	}
}
