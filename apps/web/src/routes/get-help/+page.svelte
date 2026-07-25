<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head>
	<title>{m.hero_get_help()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.get_help_title()}</h1>

<div class="list">
	<a class="list-row" href={localizeHref('/get-help/medical')}>
		<Icon name="help" />
		<span class="row-label">{m.gh_doctor()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/get-help/aid')}>
		<Icon name="offer" />
		<span class="row-label">{m.gh_food()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/stay-safe/rights')}>
		<Icon name="book" />
		<span class="row-label">{m.gh_legal()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/directory')}>
		<Icon name="shield" />
		<span class="row-label">{m.gh_talk()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/document')}>
		<Icon name="camera" />
		<span class="row-label">{m.gh_document()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/directory')}>
		<Icon name="compass" />
		<span class="row-label">{m.gh_more()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
</div>

<!--
	NO STATE EMERGENCY NUMBER, ANYWHERE (maintainer decision, 2026-07-26).

	This page shipped a dial link to the integrated state emergency line. In India
	that line answers at a police control room. On a platform whose stated
	adversary is the state, handing a protestor that number routes them to the
	adversary and discloses their situation and their cell to it.

	So the number is gone, and it is not replaced by another one: every helpline
	this app offers comes from `resource_entries`, which admits organisations that
	consented to be listed and nothing else. The medical path is the "A doctor or
	medicine" row above, which reaches those organisations. A row here would be
	the same destination twice, so what replaces the block is the fact itself.

	We do not tell anyone what to do with that fact. Someone bleeding may well
	decide the call is worth it, and that is theirs to decide with the consequence
	in front of them rather than hidden.

	`tools/gates/gate-ai-tells.mjs` now fails the build on a hardcoded dial link in
	any app source file, and on a state emergency number in any copy file, so this
	cannot come back as a convenience during a later pass. The gate scans comments
	too, which is why this one describes the number rather than spelling it.
-->
<p class="muted safety-copy">{m.no_state_helpline()}</p>
<p class="muted safety-copy">{m.no_state_helpline_2()}</p>
