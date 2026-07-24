<script lang="ts">
	import { labelText, labelMeaning, type LabelKind } from '$lib/verification';

	// Word first, at chip size. Colour is decoration only (on the symbol + border),
	// never the sole signal — the word carries the meaning (PRD §15).
	let { kind, showMeaning = false }: { kind: LabelKind; showMeaning?: boolean } = $props();

	const symbol: Record<LabelKind, string> = { team: '✓', nearby: '◎', unchecked: '○', problem: '!' };
</script>

<span class="vwrap">
	<span class="vchip vchip-{kind}">
		<span class="vsym" aria-hidden="true">{symbol[kind]}</span>
		<span class="vword">{labelText(kind)}</span>
	</span>
	{#if showMeaning}
		<span class="vmean muted">{labelMeaning(kind)}</span>
	{/if}
</span>

<style>
	.vwrap {
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
	}
	.vchip {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		align-self: flex-start;
		padding: 2px var(--sp-2);
		border: 1px solid var(--border);
		border-radius: var(--r-pill);
		font-size: var(--text-xs);
	}
	.vword {
		color: var(--text);
		font-weight: var(--fw-semi);
	}
	.vsym {
		font-weight: 700;
	}
	.vchip-team {
		border-color: var(--safe);
	}
	.vchip-team .vsym {
		color: var(--safe);
	}
	.vchip-nearby {
		border-color: var(--accent);
	}
	.vchip-nearby .vsym {
		color: var(--accent);
	}
	.vchip-unchecked .vsym {
		color: var(--text-muted);
	}
	.vchip-problem {
		border-color: var(--caution);
	}
	.vchip-problem .vsym {
		color: var(--caution);
	}
	.vmean {
		font-size: var(--text-xs);
	}
</style>
