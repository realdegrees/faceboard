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
		subtractNeutral,
		toTemplate
	} from '$lib/triggers/features';
	import { newId, type Modality, type Trigger } from '$lib/types';
	import CameraPreview from './CameraPreview.svelte';
	import Modal from './Modal.svelte';

	let {
		modality,
		onClose,
		onSaved
	}: { modality: Modality; onClose: () => void; onSaved: (t: Trigger) => void } = $props();

	const MAX_SAMPLES = 20;
	const MAX_RECORD_MS = 3500;

	let name = $state('');
	let handCount = $state<1 | 2>(1);
	let mode = $state<'pose' | 'gesture'>('pose'); // hand only

	let samples = $state<number[][]>([]); // face + hand pose
	let neutral = $state<number[] | null>(null); // face only
	let takes = $state<number[][][]>([]); // hand gesture templates

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

	function poseVector(): number[] | null {
		if (modality === 'face') return engine.face ? faceVector(engine.face) : null;
		const ordered = orderHands(engine.hands, handCount);
		return ordered ? normalizeStaticPose(ordered) : null;
	}

	const consistency = $derived.by(() => {
		if (mode === 'gesture' || samples.length === 0) return null;
		const cur = poseVector();
		if (!cur) return null;
		if (modality === 'face') {
			const c = subtractNeutral(cur, neutral ?? undefined);
			const refs = neutral ? samples.map((s) => subtractNeutral(s, neutral!)) : samples;
			return bestCosine(c, refs);
		}
		return bestCosine(cur, samples);
	});

	function captureSample() {
		const v = poseVector();
		if (v && samples.length < MAX_SAMPLES) samples = [...samples, v];
	}
	function setNeutral() {
		const v = poseVector();
		if (v) neutral = v;
	}
	function undo() {
		samples = samples.slice(0, -1);
	}

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
		name.trim().length > 0 && (isGesture ? takes.length >= 2 : samples.length >= 3)
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
		if (isGesture) {
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
		} else if (modality === 'hand') {
			onSaved({
				...base,
				motion: 'static',
				hands: handCount,
				samples: $state.snapshot(samples) as number[][],
				threshold: 0.9,
				cooldownMs: 800
			});
		} else {
			onSaved({
				...base,
				samples: $state.snapshot(samples) as number[][],
				neutral: neutral ? ($state.snapshot(neutral) as number[]) : undefined,
				threshold: 0.8,
				cooldownMs: 800
			});
		}
	}

	const segBtn =
		'flex-1 rounded-md px-3 py-1.5 text-[12px] transition-colors';
</script>

<Modal open {title} {onClose} maxWidth="48rem">
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
					placeholder={modality === 'face' ? 'e.g. Big grin' : isGesture ? 'e.g. Wave' : 'e.g. Rock on'}
					class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-border-strong"
				/>
			</div>

			{#if modality === 'hand'}
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
			{/if}

			{#if modality === 'face'}
				<div class="rounded-lg border border-border bg-surface-1 p-3">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-[12px] text-text">Neutral baseline</p>
							<p class="text-[11px] text-faint">Relax your face, then set it. Improves accuracy.</p>
						</div>
						<button onclick={setNeutral} disabled={!present} class="shrink-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:text-text disabled:opacity-40">
							{neutral ? 'Reset' : 'Set'}
						</button>
					</div>
				</div>
			{/if}

			{#if isGesture}
				<div class="rounded-lg border border-border bg-surface-1 p-3">
					<div class="mb-2 flex items-center justify-between text-[12px]">
						<span class="text-text">Takes</span>
						<span class="text-faint">{takes.length} recorded</span>
					</div>
					<p class="mb-3 text-[11px] text-faint">
						Record the {handCount === 2 ? 'two-handed ' : ''}motion a few times (2+ recommended). Each
						take is ≤{MAX_RECORD_MS / 1000}s.
					</p>
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
						<button onclick={removeTake} disabled={takes.length === 0 || recording} class="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-40">
							Undo
						</button>
					</div>
				</div>
			{:else}
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
						<button onclick={captureSample} disabled={!present || samples.length >= MAX_SAMPLES} class="flex-1 rounded-md bg-accent/90 px-3 py-2 text-[12px] font-medium text-black transition-colors hover:bg-accent disabled:opacity-40">
							Capture sample
						</button>
						<button onclick={undo} disabled={samples.length === 0} class="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-40">
							Undo
						</button>
					</div>
				</div>
			{/if}

			<div class="mt-auto flex justify-end gap-2">
				<button onclick={onClose} class="rounded-lg border border-border bg-surface-2 px-4 py-2 text-[13px] text-muted transition-colors hover:text-text">
					Cancel
				</button>
				<button onclick={save} disabled={!canSave} class="rounded-lg bg-accent/90 px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
					Save trigger
				</button>
			</div>
		</div>
	</div>
</Modal>
