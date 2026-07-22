<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	function setSize(size: 'normal' | 'big') {
		if (size === 'big') document.documentElement.dataset.textsize = 'big';
		else delete document.documentElement.dataset.textsize;
		try {
			localStorage.setItem('textsize', size === 'big' ? 'big' : '');
		} catch {
			/* not persisted; still applied for this visit */
		}
	}
</script>

<svelte:head>
	<title>{m.set_text_size()} · {m.app_name()}</title>
</svelte:head>

<h1>{m.set_text_size()}</h1>
<p class="muted">{m.set_text_size_hint()}</p>

<div class="list">
	<button class="list-row" onclick={() => setSize('normal')}>
		<span class="row-label">{m.set_text_normal()}</span>
	</button>
	<button class="list-row" onclick={() => setSize('big')}>
		<span class="row-label">{m.set_text_big()}</span>
	</button>
</div>
