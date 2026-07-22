<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head>
	<title>{m.hero_give_help()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.give_help_title()}</h1>

<div class="list">
	<div class="list-row" aria-disabled="true">
		<Icon name="offer" />
		<span class="row-label">{m.gv_food()}</span>
		<span class="card-sub">{m.not_open_yet()}</span>
	</div>
	<div class="list-row" aria-disabled="true">
		<Icon name="help" />
		<span class="row-label">{m.gv_skill()}</span>
		<span class="card-sub">{m.not_open_yet()}</span>
	</div>
	<a class="list-row" href={localizeHref('/directory')}>
		<Icon name="book" />
		<span class="row-label">{m.gv_resource()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
	<a class="list-row" href={localizeHref('/nearby')}>
		<Icon name="compass" />
		<span class="row-label">{m.gv_share()}</span>
		<span class="chev"><Icon name="chevron" size={18} /></span>
	</a>
</div>

<p class="muted">{m.opens_after_checks()} {m.works_now()}</p>
