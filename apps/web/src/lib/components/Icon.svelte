<script lang="ts">
	// Simple stroke icons. Always paired with a visible text label — an icon
	// never stands alone (PRD §15), so every instance is decorative.
	let { name, size = 24 }: { name: string; size?: number } = $props();

	const paths: Record<string, string> = {
		home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
		shield: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z',
		camera: 'M4 8h3l2-2h6l2 2h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
		compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15 9l-2 5-4 2 2-5z',
		book: 'M5 4h6v16H7a2 2 0 0 1-2-2z M11 4h8v14a2 2 0 0 1-2 2h-6z',
		help: 'M12 21c-4-3-8-6-8-10a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 11c0 4-4 7-8 10z',
		offer: 'M12 4v16 M4 12h16',
		gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1',
		chevron: 'M9 6l6 6-6 6',
		phone: 'M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
		globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={paths[name] ?? ''} />
</svg>
