<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { app } from '$lib/stores/app.svelte';
	import { PRESETS } from '$lib/triggers/presets';
	import type { Preset } from '$lib/triggers/presets';
	import { newId, type Modality, type Trigger } from '$lib/types';
	import TriggerCard from '$lib/components/TriggerCard.svelte';
	import CaptureDialog from '$lib/components/CaptureDialog.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let presetOpen = $state(false);
	let captureModality = $state<Modality | null>(null);

	const triggers = $derived(app.settings.triggers);
	const facePresets = PRESETS.filter((p) => p.modality === 'face');
	const handPresets = PRESETS.filter((p) => p.modality === 'hand');

	function addPreset(p: Preset) {
		const t: Trigger = {
			id: newId(),
			name: p.name,
			modality: p.modality,
			kind: 'builtin',
			builtinId: p.id,
			threshold: p.defaultThreshold,
			holdMs: 0,
			cooldownMs: 800,
			soundId: null,
			enabled: true,
			createdAt: Date.now()
		};
		app.addTrigger(t);
		presetOpen = false;
	}

	function onSaved(t: Trigger) {
		app.addTrigger(t);
		captureModality = null;
	}
</script>

<section class="mx-auto max-w-5xl px-8 py-7">
	<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-[19px] font-semibold tracking-tight">Triggers</h1>
			<p class="mt-1 text-[13px] text-muted">Facial expressions and hand signs that fire your sounds.</p>
		</div>
		<div class="flex gap-2">
			<button
				onclick={() => (presetOpen = true)}
				class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text transition-colors hover:bg-surface-3"
			>
				Add preset
			</button>
			<button
				onclick={() => (captureModality = 'face')}
				class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text transition-colors hover:bg-surface-3"
			>
				Record face
			</button>
			<button
				onclick={() => (captureModality = 'hand')}
				class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text transition-colors hover:bg-surface-3"
			>
				Record hand
			</button>
		</div>
	</header>

	{#if triggers.length === 0}
		<div
			class="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center text-[13px] text-faint"
		>
			No triggers yet. Add a preset or record your own facial expression or hand sign.
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each triggers as trigger (trigger.id)}
				<div animate:flip={{ duration: 200 }} transition:fly={{ y: 8, duration: 160 }}>
					<TriggerCard {trigger} />
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- Preset picker -->
<Modal open={presetOpen} title="Add a preset trigger" onClose={() => (presetOpen = false)} maxWidth="40rem">
	<div class="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
		<div>
			<h3 class="mb-2 text-[11px] font-medium tracking-wide text-faint uppercase">Facial expressions</h3>
			<div class="flex flex-col gap-1">
				{#each facePresets as p (p.id)}
					<button
						onclick={() => addPreset(p)}
						class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[13px] text-text transition-colors hover:border-border-strong hover:bg-surface-3"
					>
						{p.name}
					</button>
				{/each}
			</div>
		</div>
		<div>
			<h3 class="mb-2 text-[11px] font-medium tracking-wide text-faint uppercase">Hand signs</h3>
			<div class="flex flex-col gap-1">
				{#each handPresets as p (p.id)}
					<button
						onclick={() => addPreset(p)}
						class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[13px] text-text transition-colors hover:border-border-strong hover:bg-surface-3"
					>
						{p.name}
					</button>
				{/each}
			</div>
		</div>
	</div>
</Modal>

{#if captureModality}
	<CaptureDialog modality={captureModality} onClose={() => (captureModality = null)} {onSaved} />
{/if}
