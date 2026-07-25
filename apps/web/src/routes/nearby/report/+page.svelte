<script lang="ts">
	/**
	 * Sending one area update, and keeping it alive.
	 *
	 * NO COORDINATE IS COLLECTED, ASKED FOR, OR AVAILABLE. The only place data goes
	 * is a zone name from the signed list plus one of nine closed signal types. There
	 * is no self-location primitive to leak.
	 *
	 * THE CREDENTIAL IS THE LONG-LIVED ONE, NEVER A ONE-SHOT. The board's dedup token
	 * derives from the certificate hash, so a fresh certificate per heartbeat would
	 * be a fresh apparent reporter every 45 seconds — it would inflate the count
	 * without bound and defeat the density floor this page exists to respect. The
	 * route refuses one-shots as well; this is the client half of the same rule.
	 *
	 * THE HEARTBEAT IS NOT A REFRESH TIMER. The board is memory-only and an idle
	 * Durable Object is evicted at 70-140 s, so the re-post is simultaneously the
	 * durability mechanism, the clock and the keep-alive. It runs only while this tab
	 * is visible, because a hidden tab reporting is a reporter who is not there, and
	 * the density floor would count them as present.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { regionLabel, regionState } from '$lib/region';
	import { signalLabel } from '$lib/liveboard-labels';
	// shouldHeartbeat carries the visibility check AND the session ceiling, so the
	// ceiling cannot be honoured in one caller and forgotten in another.
	import { nextHeartbeatMs, shouldHeartbeat } from '$lib/liveboard-client';
	import { EMPTY_ZONE_STATE, verifyFetchedZones, type ZoneListState } from '$lib/liveboard-zones';
	import { credentialHeaders } from '$lib/credential';
	// REPORTABLE_SIGNALS is DERIVED from QUORUM_REQUIRED in worker-lib, not listed
	// here. A quorum signal offered on this page would collect reports the route
	// refuses; deriving it means a signal added to QUORUM_REQUIRED later leaves this
	// picker on its own.
	import { REPORTABLE_SIGNALS, type SignalType } from '@harborage/worker-lib/liveboard';

	let zoneState = $state<ZoneListState>(EMPTY_ZONE_STATE);
	let zoneId = $state<string>('');
	let chosen = $state<SignalType | ''>('');
	let status = $state<'idle' | 'live' | 'closed' | 'failed'>('idle');
	let loaded = $state(false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let startedAtMs = 0;

	const zonesHere = $derived(zoneState.zones);

	async function loadZones() {
		try {
			const res = await fetch('/api/live/zones');
			zoneState = await verifyFetchedZones(await res.json(), zoneState.epoch);
		} catch {
			zoneState = { zones: [], epoch: zoneState.epoch, reason: 'unreachable' };
		}
		loaded = true;
	}

	async function send(): Promise<boolean> {
		if (!zoneId || !chosen) return false;
		const body = new TextEncoder().encode(JSON.stringify({ zone_id: zoneId, signal: chosen }));
		try {
			const res = await fetch('/api/live/report', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(await credentialHeaders('document', 'POST', '/api/live/report', body))
				},
				body
			});
			if (res.status === 202) return true;
			// 403 is the flag, which is the state today. Said plainly rather than
			// retried, because retrying a closed feature is a battery cost and a
			// request pattern for nothing.
			status = res.status === 403 ? 'closed' : 'failed';
			return false;
		} catch {
			status = 'failed';
			return false;
		}
	}

	function stop() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function beat() {
		stop();
		const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
		if (!shouldHeartbeat({ visible, startedAtMs, nowMs: Date.now() })) {
			if (status === 'live') status = 'idle';
			return;
		}
		void send().then((ok) => {
			if (!ok) return;
			timer = setTimeout(beat, nextHeartbeatMs());
		});
	}

	async function start() {
		startedAtMs = Date.now();
		if (await send()) {
			status = 'live';
			timer = setTimeout(beat, nextHeartbeatMs());
		}
	}

	onMount(() => {
		void loadZones();
		const onVisible = () => {
			if (document.visibilityState === 'visible' && status === 'live') beat();
			else stop();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			stop();
		};
	});
</script>

<svelte:head>
	<title>{m.report_title()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.report_title()}</h1>

<p>{m.report_no_location()}</p>
<p class="muted">{m.report_shared()}</p>

{#if loaded && zoneState.zones.length === 0}
	<p>{m.report_no_zones()}</p>
{/if}

{#if zonesHere.length > 0}
	<label class="lbl" for="rep-zone">{m.report_area()}</label>
	<select id="rep-zone" class="field" bind:value={zoneId}>
		<option value="">{m.incidents_filter_all_regions()}</option>
		{#each zonesHere as z (z.zone_id)}
			<option value={z.zone_id}
				>{regionLabel(z.region_bucket)} · {regionState(z.region_bucket)}</option
			>
		{/each}
	</select>

	<p class="lbl">{m.report_pick()}</p>
	<ul class="picks">
		{#each REPORTABLE_SIGNALS as s (s)}
			<li>
				<button
					type="button"
					class="pick"
					class:on={chosen === s}
					aria-pressed={chosen === s}
					onclick={() => (chosen = s)}
				>
					{signalLabel[s]()}
				</button>
			</li>
		{/each}
	</ul>

	<p>
		<button type="button" class="btn" disabled={!zoneId || !chosen} onclick={() => void start()}>
			{m.board_send()}
		</button>
	</p>
{/if}

{#if status === 'live'}
	<p>{m.report_sent()}</p>
	<p>{m.report_keep_open()}</p>
	<p class="muted">{m.report_stops()}</p>
{:else if status === 'closed'}
	<p>{m.report_closed()}</p>
{:else if status === 'failed'}
	<p>{m.nearby_empty()}</p>
{/if}

<p class="muted">{m.board_not_watching()}</p>

<p><a href="/nearby">{m.board_title()}</a></p>

<style>
	.lbl {
		display: block;
		margin-top: var(--sp-3);
		font-weight: 600;
	}
	.picks {
		list-style: none;
		padding: 0;
		margin: var(--sp-2) 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.pick {
		min-height: 48px;
		padding: var(--sp-2) var(--sp-3);
		font-size: 1.0625rem;
		border: 2px solid var(--line);
		border-radius: var(--r-2, 8px);
		background: var(--surface);
		color: inherit;
	}
	.pick.on {
		border-color: currentColor;
		font-weight: 700;
	}
</style>
