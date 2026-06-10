<script lang="ts">
	import { untrack } from 'svelte';
	import { app } from '$lib/stores/app.svelte';
	import type { Trigger } from '$lib/types';
	import FaceRegionSelector from './FaceRegionSelector.svelte';
	import Modal from './Modal.svelte';

	let { trigger, onClose }: { trigger: Trigger; onClose: () => void } = $props();

	// Edit a local copy seeded from the trigger (the parent remounts us per trigger).
	let name = $state(untrack(() => trigger.name));
	let regions = $state<string[]>(untrack(() => [...(trigger.regions ?? [])]));
	let threshold = $state(untrack(() => trigger.threshold));

	function toggleRegion(id: string) {
		regions = regions.includes(id) ? regions.filter((r) => r !== id) : [...regions, id];
	}
	const canSave = $derived(name.trim().length > 0 && regions.length >= 1);
	function save() {
		if (!canSave) return;
		app.updateTrigger(trigger.id, { name: name.trim(), regions: [...regions], threshold });
		onClose();
	}
</script>

<Modal open title="Edit expression" {onClose} maxWidth="40rem">
	<div class="flex flex-col gap-4 p-5">
		<div>
			<label for="edit-name" class="mb-1.5 block text-[12px] text-muted">Name</label>
			<input
				id="edit-name"
				bind:value={name}
				class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-border-strong"
			/>
		</div>

		<div>
			<p class="mb-2 text-[11px] text-faint">Highlight the areas that must match this expression.</p>
			{#if trigger.meshLandmarks}
				<FaceRegionSelector landmarks={trigger.meshLandmarks} selected={regions} onToggle={toggleRegion} />
			{/if}
		</div>

		<label class="flex flex-col gap-1">
			<span class="text-[11px] text-faint">Match threshold · {threshold.toFixed(2)}</span>
			<input type="range" min="0.4" max="0.95" step="0.01" bind:value={threshold} class="fb-range mt-1" />
		</label>

		<div class="flex justify-end gap-2">
			<button onclick={onClose} class="rounded-lg border border-border bg-surface-2 px-4 py-2 text-[13px] text-muted transition-colors hover:text-text">Cancel</button>
			<button onclick={save} disabled={!canSave} class="rounded-lg bg-accent/90 px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent disabled:opacity-40">Save</button>
		</div>
	</div>
</Modal>
