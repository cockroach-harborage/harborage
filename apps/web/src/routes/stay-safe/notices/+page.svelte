<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import {
		loadNotices,
		isDirective,
		noticeTitle,
		noticeBody,
		noticeVerified,
		type PublicNotice
	} from '$lib/notices';
	import type { KeyDirectoryEntry, RevocationEntry } from '@harborage/crypto/notice';

	let loaded = $state(false);
	let notices = $state<PublicNotice[]>([]);
	let stale = $state(false);

	// The on-device trusted key directory arrives inside a signed pack after the
	// offline key ceremony. Until then it is empty, so every notice verifies to
	// NOT verified (fail-closed, honest).
	const directory: KeyDirectoryEntry[] = [];
	const revocations: RevocationEntry[] = [];

	onMount(async () => {
		const r = await loadNotices();
		notices = r.notices;
		stale = r.stale;
		loaded = true;
	});
</script>

<svelte:head>
	<title>{m.notices_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="safety-copy">{m.notices_title()}</h1>

<a class="list-row" href={localizeHref('/settings/verify-channel')}>
	<Icon name="shield" />
	<span class="row-label">{m.notices_verify_channel()}</span>
	<span class="chev"><Icon name="chevron" size={18} /></span>
</a>

{#if stale}
	<p class="stale" role="status">{m.notices_stale()}</p>
{/if}

{#if loaded && notices.length === 0}
	<p class="muted">{m.notices_empty()}</p>
	<p class="muted">{m.notices_what()}</p>
{/if}

{#each notices as n (n.id)}
	<article class="card notice" class:superseded={!!n.superseded_by}>
		{#if isDirective(n.notice_type)}
			<p class="directive" role="alert">{m.notice_directive_warning()}</p>
		{/if}
		<h2 class="safety-copy">{noticeTitle(n)}</h2>
		<p class="safety-copy body">{noticeBody(n)}</p>
		{#if n.area}
			<p class="muted area">{n.area}</p>
		{/if}
		<p class="meta">
			<span>{n.published_at}</span>
			{#if !noticeVerified(n, directory, revocations)}
				<span class="unverified">{m.notice_unverified()}</span>
			{/if}
			{#if n.superseded_by}
				<span class="muted">{m.notice_superseded()}</span>
			{/if}
		</p>
	</article>
{/each}

<style>
	.notice {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		margin-bottom: var(--sp-3);
	}
	.notice.superseded {
		opacity: 0.6;
	}
	.directive {
		background: var(--surface);
		border: 2px solid var(--hazard);
		border-radius: var(--r-sm);
		padding: var(--sp-3);
		color: var(--hazard);
		font-weight: var(--fw-semi);
		font-size: var(--text-sm);
	}
	.stale {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: var(--sp-2) var(--sp-3);
		font-size: var(--text-sm);
	}
	.body {
		white-space: pre-wrap;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.unverified {
		color: var(--hazard);
		font-weight: var(--fw-semi);
	}
</style>
