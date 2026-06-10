<script lang="ts">
	import CameraPreview from '$lib/components/CameraPreview.svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import { startDetection, stopDetection, toggleDetection } from '$lib/detection/control';
	import { app } from '$lib/stores/app.svelte';
	import { runtime } from '$lib/triggers/runtime.svelte';
	import { phoneHost } from '$lib/phone/host.svelte';

	const general = $derived(app.settings.general);

	const onPhone = $derived(engine.source === 'phone');
	const showCameraControls = $derived(engine.devices.length > 1 || onPhone);
	const cameraValue = $derived(onPhone ? 'phone' : (general.cameraDeviceId ?? ''));

	const topShapes = $derived.by(() => {
		const bs = engine.face?.blendshapes;
		if (!bs) return [] as [string, number][];
		return Object.entries(bs)
			.filter(([name]) => name !== '_neutral')
			.sort((a, b) => b[1] - a[1])
			.slice(0, 6);
	});

	// Brief accent flash on the preview whenever any trigger fires.
	const latestFireTs = $derived(runtime.recent[0]?.ts ?? 0);

	const activeTriggers = $derived(
		app.settings.triggers.filter((t) => runtime.activeIds.includes(t.id))
	);

	async function onPickCamera(e: Event) {
		const val = (e.target as HTMLSelectElement).value;
		if (val === 'phone') return; // pair a phone from Settings → Phone camera
		const wasRunning = engine.active || onPhone;
		if (engine.source === 'phone') await phoneHost.stop();
		app.setGeneral({ cameraDeviceId: val || null });
		if (wasRunning) {
			stopDetection();
			await startDetection();
		}
	}

	const statusLabel = $derived(
		engine.status === 'running'
			? `Live · ${engine.fps} fps`
			: engine.status === 'loading'
				? 'Starting…'
				: engine.status === 'error'
					? 'Error'
					: 'Idle'
	);
</script>

<section class="mx-auto max-w-5xl px-8 py-7">
	<header class="mb-6 flex items-end justify-between">
		<div>
			<h1 class="text-[19px] font-semibold tracking-tight">Dashboard</h1>
			<p class="mt-1 text-[13px] text-muted">Live camera, detection status and triggers.</p>
		</div>
		<button
			onclick={() => toggleDetection()}
			class="rounded-lg px-4 py-2 text-[13px] font-medium transition-colors
				{engine.active
				? 'bg-surface-3 text-text hover:bg-surface-2'
				: 'bg-accent/90 text-black hover:bg-accent'}"
		>
			{engine.active || engine.status === 'loading' ? 'Stop detection' : 'Start detection'}
		</button>
	</header>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<!-- Camera -->
		<div class="lg:col-span-2 rounded-card border border-border bg-surface-1 p-4">
			<div class="relative aspect-video w-full">
				{#key latestFireTs}
					{#if latestFireTs}
						<div
							class="pointer-events-none absolute inset-0 z-10 rounded-lg"
							style="animation: fb-flash 480ms ease-out forwards;"
						></div>
					{/if}
				{/key}
				{#if engine.stream}
					<CameraPreview />
				{:else}
					<div
						class="grid h-full w-full place-items-center rounded-lg border border-dashed border-border-strong bg-surface-2 text-center text-[13px] text-faint"
					>
						{#if engine.status === 'error'}
							<div class="px-6">
								<p class="text-red-400/90">Camera error</p>
								<p class="mt-1 text-faint">{engine.error}</p>
							</div>
						{:else}
							Camera preview
						{/if}
					</div>
				{/if}
			</div>

			<div class="mt-3 flex items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-[12px]">
					<span
						class="inline-block h-1.5 w-1.5 rounded-full {engine.active
							? 'bg-accent'
							: engine.status === 'error'
								? 'bg-red-500'
								: 'bg-faint'}"
					></span>
					<span class="text-muted">{statusLabel}</span>
					{#if engine.active}
						<span class="text-faint">· {app.settings.triggers.length} triggers</span>
					{/if}
				</div>
				{#if showCameraControls}
					<div class="flex items-center gap-2">
						{#if onPhone}
							<button
								onclick={() => phoneHost.flipCamera()}
								class="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted transition-colors hover:text-text"
							>
								Flip
							</button>
						{/if}
						<select
							class="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted outline-none focus:border-border-strong"
							value={cameraValue}
							onchange={onPickCamera}
						>
							<option value="">Default camera</option>
							{#each engine.devices as d (d.deviceId)}
								<option value={d.deviceId}>{d.label}</option>
							{/each}
							{#if onPhone}
								<option value="phone">Phone camera</option>
							{/if}
						</select>
					</div>
				{/if}
			</div>
		</div>

		<!-- Live readout -->
		<div class="flex flex-col gap-4">
			<div class="rounded-card border border-border bg-surface-1 p-4">
				<h2 class="mb-3 text-[12px] font-medium tracking-wide text-muted uppercase">Face</h2>
				{#if topShapes.length}
					<div class="flex flex-col gap-2">
						{#each topShapes as [name, score] (name)}
							<div class="flex items-center gap-2">
								<span class="w-32 shrink-0 truncate text-[11px] text-faint">{name}</span>
								<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
									<div
										class="h-full rounded-full bg-accent/80"
										style="width: {Math.round(score * 100)}%"
									></div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-[12px] text-faint">No face detected.</p>
				{/if}
			</div>

			<div class="rounded-card border border-border bg-surface-1 p-4">
				<h2 class="mb-3 text-[12px] font-medium tracking-wide text-muted uppercase">Hands</h2>
				{#if engine.hands.length}
					<div class="flex flex-col gap-2">
						{#each engine.hands as hand, i (i)}
							<div class="flex items-center justify-between text-[12px]">
								<span class="text-muted">{hand.handedness}</span>
								<span class="text-faint">
									{hand.gesture ? `${hand.gesture.name} ${Math.round(hand.gesture.score * 100)}%` : '—'}
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-[12px] text-faint">No hands detected.</p>
				{/if}
			</div>

			<div class="rounded-card border border-border bg-surface-1 p-4">
				<h2 class="mb-3 text-[12px] font-medium tracking-wide text-muted uppercase">Activity</h2>
				{#if activeTriggers.length}
					<div class="mb-3 flex flex-wrap gap-1.5">
						{#each activeTriggers as t (t.id)}
							<span
								class="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
								style="animation: fb-pulse 1.4s ease-in-out infinite;">{t.name}</span
							>
						{/each}
					</div>
				{/if}
				{#if runtime.recent.length}
					<div class="flex flex-col gap-1.5">
						{#each runtime.recent.slice(0, 5) as r (r.ts)}
							<div class="flex items-center justify-between text-[12px]">
								<span class="text-muted">{r.name}</span>
								<span class="text-faint">fired</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-[12px] text-faint">No triggers fired yet.</p>
				{/if}
			</div>
		</div>
	</div>
</section>
