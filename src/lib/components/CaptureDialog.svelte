<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import { app } from '$lib/stores/app.svelte';
	import {
		bestCosine,
		faceVector,
		handsFrameVector,
		normalizeStaticPose,
		orderHands,
		toTemplate
	} from '$lib/triggers/features';
	import { suggestRegions } from '$lib/triggers/regions';
	import { newId, type Modality, type Trigger } from '$lib/types';
	import CameraPreview from './CameraPreview.svelte';
	import FaceRegionSelector from './FaceRegionSelector.svelte';
	import Modal from './Modal.svelte';

	let {
		modality,
		onClose,
		onSaved
	}: { modality: Modality; onClose: () => void; onSaved: (t: Trigger) => void } = $props();

	const MAX_SAMPLES = 20;
	const MAX_RECORD_MS = 3500;
	const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

	let name = $state('');

	// Face (single capture + weighted regions)
	let captured = $state(false);
	let target = $state<number[] | null>(null);
	let meshLandmarks = $state<number[] | null>(null);
	let regions = $state<string[]>([]);
	let faceThreshold = $state(0.72);

	// Hand
	let handCount = $state<1 | 2>(1);
	let mode = $state<'pose' | 'gesture'>('pose');
	let samples = $state<number[][]>([]);
	let takes = $state<number[][][]>([]);
	let recording = $state(false);
	let recordCount = $state(0);
	let recordFrames: number[][] = [];
	let recordTimer: ReturnType<typeof setInterval> | null = null;
	let recordStart = 0;
	const takeDurations: number[] = [];

	onMount(() => {
		void (async () => {
			const mods = { face: modality === 'face', hand: modality === 'hand' };
			if (!engine.detecting) {
				engine.modalities = mods;
				await engine.startDetection(app.settings.general.cameraDeviceId);
			} else {
				await engine.ensureModalities(mods);
			}
		})();
	});
	onDestroy(() => {
		if (recordTimer) clearInterval(recordTimer);
	});

	const present = $derived(
		modality === 'face' ? !!engine.face : orderHands(engine.hands, handCount) !== null
	);

	// --- Face ---
	function captureFace() {
		if (!engine.face) return;
		target = faceVector(engine.face);
		meshLandmarks = engine.face.landmarks.flatMap((p) => [r4(p.x), r4(p.y), r4(p.z)]);
		regions = suggestRegions(target);
		captured = true;
	}
	function toggleRegion(id: string) {
		regions = regions.includes(id) ? regions.filter((r) => r !== id) : [...regions, id];
	}

	// --- Hand pose ---
	function poseVector(): number[] | null {
		const ordered = orderHands(engine.hands, handCount);
		return ordered ? normalizeStaticPose(ordered) : null;
	}
	const consistency = $derived.by(() => {
		if (modality !== 'hand' || mode !== 'pose' || samples.length === 0) return null;
		const cur = poseVector();
		return cur ? bestCosine(cur, samples) : null;
	});
	function captureSample() {
		const v = poseVector();
		if (v && samples.length < MAX_SAMPLES) samples = [...samples, v];
	}
	function undoSample() {
		samples = samples.slice(0, -1);
	}

	// --- Hand gesture ---
	function startRecording() {
		if (recording) return;
		recordFrames = [];
		recordCount = 0;
		recordStart = performance.now();
		recording = true;
		recordTimer = setInterval(() => {
			const ordered = orderHands(engine.hands, handCount);
			if (ordered) {
				recordFrames.push(handsFrameVector(ordered));
				recordCount = recordFrames.length;
			}
			if (performance.now() - recordStart > MAX_RECORD_MS) stopRecording();
		}, 30);
	}
	function stopRecording() {
		if (recordTimer) clearInterval(recordTimer);
		recordTimer = null;
		recording = false;
		const dur = performance.now() - recordStart;
		if (recordFrames.length >= 8) {
			takes = [...takes, toTemplate(recordFrames)];
			takeDurations.push(dur);
		}
		recordFrames = [];
		recordCount = 0;
	}
	function removeTake() {
		takes = takes.slice(0, -1);
		takeDurations.pop();
	}

	const isGesture = $derived(modality === 'hand' && mode === 'gesture');
	const canSave = $derived(
		name.trim().length > 0 &&
			(modality === 'face'
				? captured && regions.length >= 1
				: isGesture
					? takes.length >= 2
					: samples.length >= 3)
	);

	const title = $derived(
		modality === 'face'
			? 'Record facial expression'
			: mode === 'gesture'
				? 'Record hand gesture'
				: 'Record hand sign'
	);

	function save() {
		if (!canSave) return;
		const base = {
			id: newId(),
			name: name.trim(),
			modality,
			kind: 'custom' as const,
			holdMs: 0,
			soundId: null,
			enabled: true,
			createdAt: Date.now()
		};
		if (modality === 'face') {
			onSaved({
				...base,
				target: $state.snapshot(target) as number[],
				meshLandmarks: $state.snapshot(meshLandmarks) as number[],
				regions: $state.snapshot(regions) as string[],
				threshold: faceThreshold,
				cooldownMs: 800
			});
		} else if (isGesture) {
			const avg = takeDurations.length
				? Math.round(takeDurations.reduce((a, b) => a + b, 0) / takeDurations.length)
				: 1500;
			onSaved({
				...base,
				motion: 'dynamic',
				hands: handCount,
				sequences: $state.snapshot(takes) as number[][][],
				durationMs: avg,
				threshold: 0.6,
				cooldownMs: 900
			});
		} else {
			onSaved({
				...base,
				motion: 'static',
				hands: handCount,
				samples: $state.snapshot(samples) as number[][],
				threshold: 0.9,
				cooldownMs: 800
			});
		}
	}

	const segBtn = 'flex-1 rounded-md px-3 py-1.5 text-[12px] transition-colors';
</script>

<Modal open {title} {onClose} maxWidth="50rem">
	<div class="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
		<!-- Live preview -->
		<div>
			<div class="w-full overflow-hidden rounded-lg">
				{#if engine.stream}
					<CameraPreview />
				{:else}
					<div class="grid aspect-video place-items-center bg-surface-2 text-[12px] text-faint">
						Starting camera…
					</div>
				{/if}
			</div>
			<div class="mt-2 flex items-center gap-2 text-[12px]">
				<span class="inline-block h-1.5 w-1.5 rounded-full {present ? 'bg-accent' : 'bg-faint'}"></span>
				<span class="text-muted">
					{#if modality === 'face'}
						{present ? 'Face detected' : 'No face detected'}
					{:else}
						{present
							? handCount === 2
								? 'Both hands detected'
								: 'Hand detected'
							: `Show ${handCount === 2 ? 'both hands' : 'your hand'}`}
					{/if}
				</span>
				{#if consistency !== null}
					<span class="ml-auto text-faint">match {Math.round(consistency * 100)}%</span>
				{/if}
				{#if recording}
					<span class="ml-auto text-accent" style="animation: fb-pulse 1s ease-in-out infinite;">● rec {recordCount}f</span>
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
					placeholder={modality === 'face' ? 'e.g. Sly wink' : isGesture ? 'e.g. Wave' : 'e.g. Rock on'}
					class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-border-strong"
				/>
			</div>

			{#if modality === 'face'}
				{#if !captured}
					<div class="rounded-lg border border-border bg-surface-1 p-3">
						<p class="mb-3 text-[12px] text-faint">
							Make the expression and capture it once. Then highlight the face areas that define it.
						</p>
						<button
							onclick={captureFace}
							disabled={!present}
							class="w-full rounded-md bg-accent/90 px-3 py-2 text-[12px] font-medium text-black transition-colors hover:bg-accent disabled:opacity-40"
						>
							Capture expression
						</button>
					</div>
				{:else}
					<div class="rounded-lg border border-border bg-surface-1 p-3">
						<p class="mb-2 text-[11px] text-faint">
							Highlight the areas that must match (tap the mesh or the chips). Each highlighted area
							has to match the threshold.
						</p>
						{#if meshLandmarks}
							<FaceRegionSelector landmarks={meshLandmarks} selected={regions} onToggle={toggleRegion} />
						{/if}
						<button onclick={captureFace} class="mt-3 text-[11px] text-faint transition-colors hover:text-text">
							Re-capture expression
						</button>
					</div>
					<label class="flex flex-col gap-1">
						<span class="text-[11px] text-faint">Match threshold · {faceThreshold.toFixed(2)}</span>
						<input type="range" min="0.4" max="0.95" step="0.01" bind:value={faceThreshold} class="fb-range mt-1" />
					</label>
				{/if}
			{:else}
				<div class="flex gap-3">
					<div class="flex-1">
						<span class="mb-1.5 block text-[12px] text-muted">Hands</span>
						<div class="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
							<button class="{segBtn} {handCount === 1 ? 'bg-surface-3 text-text' : 'text-muted'}" onclick={() => (handCount = 1)}>One</button>
							<button class="{segBtn} {handCount === 2 ? 'bg-surface-3 text-text' : 'text-muted'}" onclick={() => (handCount = 2)}>Two</button>
						</div>
					</div>
					<div class="flex-1">
						<span class="mb-1.5 block text-[12px] text-muted">Type</span>
						<div class="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
							<button class="{segBtn} {mode === 'pose' ? 'bg-surface-3 text-text' : 'text-muted'}" onclick={() => (mode = 'pose')}>Pose</button>
							<button class="{segBtn} {mode === 'gesture' ? 'bg-surface-3 text-text' : 'text-muted'}" onclick={() => (mode = 'gesture')}>Gesture</button>
						</div>
					</div>
				</div>

				{#if isGesture}
					<div class="rounded-lg border border-border bg-surface-1 p-3">
						<div class="mb-2 flex items-center justify-between text-[12px]">
							<span class="text-text">Takes</span>
							<span class="text-faint">{takes.length} recorded</span>
						</div>
						<p class="mb-3 text-[11px] text-faint">Record the motion a few times (2+ recommended), each ≤{MAX_RECORD_MS / 1000}s.</p>
						<div class="flex gap-2">
							<button
								onclick={recording ? stopRecording : startRecording}
								disabled={!present && !recording}
								class="flex-1 rounded-md px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-40 {recording
									? 'bg-red-500/90 text-white hover:bg-red-500'
									: 'bg-accent/90 text-black hover:bg-accent'}"
							>
								{recording ? 'Stop' : 'Record take'}
							</button>
							<button onclick={removeTake} disabled={takes.length === 0 || recording} class="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-40">Undo</button>
						</div>
					</div>
				{:else}
					<div class="rounded-lg border border-border bg-surface-1 p-3">
						<div class="mb-2 flex items-center justify-between text-[12px]">
							<span class="text-text">Samples</span>
							<span class="text-faint">{samples.length} / {MAX_SAMPLES}</span>
						</div>
						<p class="mb-3 text-[11px] text-faint">Hold the sign and capture a few from slightly different angles. 3–20 recommended.</p>
						<div class="flex gap-2">
							<button onclick={captureSample} disabled={!present || samples.length >= MAX_SAMPLES} class="flex-1 rounded-md bg-accent/90 px-3 py-2 text-[12px] font-medium text-black transition-colors hover:bg-accent disabled:opacity-40">Capture sample</button>
							<button onclick={undoSample} disabled={samples.length === 0} class="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-40">Undo</button>
						</div>
					</div>
				{/if}
			{/if}

			<div class="mt-auto flex justify-end gap-2">
				<button onclick={onClose} class="rounded-lg border border-border bg-surface-2 px-4 py-2 text-[13px] text-muted transition-colors hover:text-text">Cancel</button>
				<button onclick={save} disabled={!canSave} class="rounded-lg bg-accent/90 px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">Save trigger</button>
			</div>
		</div>
	</div>
</Modal>
