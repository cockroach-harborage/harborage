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
	<a class="list-row" href={localizeHref('/directory')}>
		<Icon name="help" />
		<span class="row-label">{m.gh_doctor()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/directory')}>
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
	<a class="list-row" href={localizeHref('/record')}>
		<Icon name="camera" />
		<span class="row-label">{m.gh_record()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/directory')}>
		<Icon name="compass" />
		<span class="row-label">{m.gh_more()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
</div>

<div class="list">
	<a class="list-row" href="tel:112">
		<Icon name="phone" />
		<span class="row-label">{m.helpline_row()}</span>
		<span class="card-sub">{m.helpline_112()}</span>
	</a>
</div>
