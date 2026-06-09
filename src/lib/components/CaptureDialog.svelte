<script lang="ts">
	import { onMount } from 'svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { bestCosine, faceVector, normalizeHand, subtractNeutral } from '$lib/triggers/features';
	import { newId, type Modality, type Trigger } from '$lib/types';
	import CameraPreview from './CameraPreview.svelte';
	import Modal from './Modal.svelte';

	let {
		modality,
		onClose,
		onSaved
	}: { modality: Modality; onClose: () => void; onSaved: (t: Trigger) => void } = $props();

	const MAX_SAMPLES = 20;

	let name = $state('');
	let samples = $state<number[][]>([]);
	let neutral = $state<number[] | null>(null);

	// Bring detection up for the modality we're capturing.
	onMount(() => {
		void (async () => {
			const mods = { face: modality === 'face', hand: modality === 'hand' };
			if (!engine.active) {
				engine.modalities = mods;
				await engine.startLocal(app.settings.general.cameraDeviceId);
			} else {
				await engine.ensureModalities(mods);
			}
		})();
	});

	const present = $derived(modality === 'face' ? !!engine.face : engine.hands.length > 0);

	function currentVector(): number[] | null {
		if (modality === 'face') return engine.face ? faceVector(engine.face) : null;
		const h = engine.hands[0];
		return h ? normalizeHand(h) : null;
	}

	// Live similarity of the current pose to what's already captured.
	const consistency = $derived.by(() => {
		if (samples.length === 0) return null;
		const cur = currentVector();
		if (!cur) return null;
		if (modality === 'face') {
			const c = subtractNeutral(cur, neutral ?? undefined);
			const refs = neutral ? samples.map((s) => subtractNeutral(s, neutral!)) : samples;
			return bestCosine(c, refs);
		}
		return bestCosine(cur, samples);
	});

	function captureSample() {
		const v = currentVector();
		if (!v || samples.length >= MAX_SAMPLES) return;
		samples = [...samples, v];
	}
	function setNeutral() {
		const v = currentVector();
		if (v) neutral = v;
	}
	function undo() {
		samples = samples.slice(0, -1);
	}

	const canSave = $derived(name.trim().length > 0 && samples.length >= 3);

	function save() {
		if (!canSave) return;
		onSaved({
			id: newId(),
			name: name.trim(),
			modality,
			kind: 'custom',
			samples: $state.snapshot(samples),
			neutral: neutral ? ($state.snapshot(neutral) as number[]) : undefined,
			threshold: modality === 'face' ? 0.8 : 0.9,
			holdMs: 0,
			cooldownMs: 800,
			soundId: null,
			enabled: true,
			createdAt: Date.now()
		});
	}
</script>

<Modal open title={`Record ${modality === 'face' ? 'facial expression' : 'hand sign'}`} {onClose} maxWidth="48rem">
	<div class="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
		<!-- Live preview -->
		<div>
			<div class="aspect-video w-full overflow-hidden rounded-lg">
				{#if engine.stream}
					<CameraPreview />
				{:else}
					<div class="grid h-full place-items-center bg-surface-2 text-[12px] text-faint">
						Starting camera…
					</div>
				{/if}
			</div>
			<div class="mt-2 flex items-center gap-2 text-[12px]">
				<span class="inline-block h-1.5 w-1.5 rounded-full {present ? 'bg-accent' : 'bg-faint'}"></span>
				<span class="text-muted">
					{present
						? modality === 'face'
							? 'Face detected'
							: 'Hand detected'
						: `No ${modality === 'face' ? 'face' : 'hand'} detected`}
				</span>
				{#if consistency !== null}
					<span class="ml-auto text-faint">match {Math.round(consistency * 100)}%</span>
				{/if}
			</div>
		</div>

		<!-- Controls -->
		<div class="flex flex-col gap-4">
			<div>
				<label for="cap-name" class="mb-1.5 block text-[12px] text-muted">Name</label>
				<input
					id="cap-name"
					bind:value={name}
					placeholder={modality === 'face' ? 'e.g. Big grin' : 'e.g. Rock on'}
					class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-border-strong"
				/>
			</div>

			{#if modality === 'face'}
				<div class="rounded-lg border border-border bg-surface-1 p-3">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-[12px] text-text">Neutral baseline</p>
							<p class="text-[11px] text-faint">Relax your face, then set it. Optional but improves accuracy.</p>
						</div>
						<button
							onclick={setNeutral}
							disabled={!present}
							class="shrink-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:text-text disabled:opacity-40"
						>
							{neutral ? 'Reset' : 'Set'}
						</button>
					</div>
				</div>
			{/if}

			<div class="rounded-lg border border-border bg-surface-1 p-3">
				<div class="mb-2 flex items-center justify-between text-[12px]">
					<span class="text-text">Samples</span>
					<span class="text-faint">{samples.length} / {MAX_SAMPLES}</span>
				</div>
				<p class="mb-3 text-[11px] text-faint">
					Hold the {modality === 'face' ? 'expression' : 'sign'} and capture a few from slightly
					different angles. 3–20 recommended.
				</p>
				<div class="flex gap-2">
					<button
						onclick={captureSample}
						disabled={!present || samples.length >= MAX_SAMPLES}
						class="flex-1 rounded-md bg-accent/90 px-3 py-2 text-[12px] font-medium text-black transition-colors hover:bg-accent disabled:opacity-40"
					>
						Capture sample
					</button>
					<button
						onclick={undo}
						disabled={samples.length === 0}
						class="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-40"
					>
						Undo
					</button>
				</div>
			</div>

			<div class="mt-auto flex justify-end gap-2">
				<button
					onclick={onClose}
					class="rounded-lg border border-border bg-surface-2 px-4 py-2 text-[13px] text-muted transition-colors hover:text-text"
				>
					Cancel
				</button>
				<button
					onclick={save}
					disabled={!canSave}
					class="rounded-lg bg-accent/90 px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
				>
					Save trigger
				</button>
			</div>
		</div>
	</div>
</Modal>
