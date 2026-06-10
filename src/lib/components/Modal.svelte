<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import { fade, scale } from 'svelte/transition';
	import type { Snippet } from 'svelte';

	let {
		open = false,
		title,
		onClose,
		children,
		maxWidth = '34rem'
	}: {
		open?: boolean;
		title?: string;
		onClose?: () => void;
		children?: Snippet;
		maxWidth?: string;
	} = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose?.();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div use:portal class="fixed inset-0 z-50 grid place-items-center p-6">
		<button
			type="button"
			aria-label="Close"
			class="absolute inset-0 cursor-default bg-black/65 backdrop-blur-[2px]"
			transition:fade={{ duration: 120 }}
			onclick={() => onClose?.()}
		></button>
		<div
			class="relative w-full overflow-hidden rounded-card border border-border bg-surface-1 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.55)]"
			style="max-width: {maxWidth}"
			transition:scale={{ start: 0.97, duration: 150 }}
		>
			{#if title}
				<header class="flex items-center justify-between border-b border-border px-5 py-3.5">
					<h2 class="text-[14px] font-semibold tracking-tight">{title}</h2>
					<button
						class="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-text"
						aria-label="Close"
						onclick={() => onClose?.()}
					>
						<svg width="13" height="13" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2">
							<path d="M1 1l9 9M10 1l-9 9" />
						</svg>
					</button>
				</header>
			{/if}
			<div class="max-h-[78vh] overflow-y-auto">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
