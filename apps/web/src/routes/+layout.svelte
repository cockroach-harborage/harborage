<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import Icon from '$lib/components/Icon.svelte';
	import { network, watchNetwork } from '$lib/offline.svelte.ts';

	let { children } = $props();

	const otherLocale = $derived(getLocale() === 'hi' ? 'en' : 'hi');
	const path = $derived(page.url.pathname.replace(/^\/hi(?=\/|$)/, '') || '/');
	const isHome = $derived(path === '/');

	const tabs = $derived([
		{ href: '/', icon: 'home', label: m.nav_home(), active: path === '/' },
		{ href: '/stay-safe', icon: 'shield', label: m.nav_stay_safe(), active: path.startsWith('/stay-safe') },
		{ href: '/record', icon: 'camera', label: m.nav_record(), active: path.startsWith('/record') },
		{ href: '/nearby', icon: 'compass', label: m.nav_nearby(), active: path.startsWith('/nearby') },
		{ href: '/directory', icon: 'book', label: m.nav_directory(), active: path.startsWith('/directory') }
	]);

	function quickExit() {
		// One tap: clear sensitive view state, land on the neutral Directory view.
		try {
			sessionStorage.clear();
		} catch {
			/* storage may be unavailable; still navigate */
		}
		location.assign(localizeHref('/directory'));
	}

	onMount(() => {
		const storedTheme = localStorage.getItem('theme');
		const media = matchMedia('(prefers-color-scheme: dark)');
		const applyTheme = () => {
			const theme = storedTheme ?? (media.matches ? 'dark' : 'light');
			document.documentElement.dataset.theme = theme;
		};
		applyTheme();
		media.addEventListener('change', applyTheme);
		const textsize = localStorage.getItem('textsize');
		if (textsize) document.documentElement.dataset.textsize = textsize;
		const stopNetwork = watchNetwork();
		return () => {
			media.removeEventListener('change', applyTheme);
			stopNetwork();
		};
	});
</script>

<a class="skip-link" href="#main">{m.back()}</a>

<div class="shell">
	<header class="topbar">
		<a class="brand" href={localizeHref('/')}>{m.app_name()}</a>
		<a
			class="topbar-btn"
			href={localizeHref(path, { locale: otherLocale })}
			data-sveltekit-reload
			aria-label={m.language_toggle()}
			lang={otherLocale}
		>
			{otherLocale === 'hi' ? 'अ' : 'A'}
		</a>
		{#if isHome}
			<a class="topbar-btn" href={localizeHref('/settings')} aria-label={m.settings()}>
				<Icon name="gear" />
				<span class="visually-hidden">{m.settings()}</span>
			</a>
		{/if}
		<button class="topbar-btn" onclick={quickExit}>{m.close()}</button>
	</header>

	{#if !network.online}
		<p class="offline-strip" role="status">{m.offline_banner()}</p>
	{/if}

	<main id="main">
		{@render children()}
	</main>

	<footer class="notice-line">
		<a href={localizeHref('/limits')}>{m.footer_limits()}</a>
		·
		<a href="https://github.com/cockroach-harborage/harborage" rel="noopener">{m.footer_source()}</a>
	</footer>
</div>

<nav class="tabbar" aria-label="Main">
	<div class="tabbar-inner">
		{#each tabs as tab (tab.href)}
			<a
				class="tab"
				href={localizeHref(tab.href)}
				aria-current={tab.active ? 'page' : undefined}
			>
				<Icon name={tab.icon} size={22} />
				<span>{tab.label}</span>
			</a>
		{/each}
	</div>
</nav>
