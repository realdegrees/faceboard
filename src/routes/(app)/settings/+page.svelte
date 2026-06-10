<script lang="ts">
	import { getBridge } from '$lib/bridge';
	import { app } from '$lib/stores/app.svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import ShortcutCapture from '$lib/components/ShortcutCapture.svelte';
	import PhoneSetup from '$lib/components/PhoneSetup.svelte';

	const bridge = getBridge();
	const general = $derived(app.settings.general);

	const FPS_OPTIONS = [10, 15, 18, 24, 30];

	function setBehavior(patch: { closeToTray?: boolean; startMinimized?: boolean }) {
		app.setGeneral(patch);
		bridge?.app.setBehavior(patch);
	}

	async function setShortcut(accel: string | null) {
		app.setShortcut('toggleDetection', accel);
		await bridge?.shortcuts.register(accel);
	}
</script>

<section class="mx-auto max-w-3xl px-8 py-7">
	<header class="mb-6">
		<h1 class="text-[19px] font-semibold tracking-tight">Settings</h1>
		<p class="mt-1 text-[13px] text-muted">Detection, shortcuts, behavior and camera.</p>
	</header>

	<div class="flex flex-col gap-5">
		<!-- Detection -->
		<div class="rounded-card border border-border bg-surface-1">
			<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
				Detection
			</h2>
			<div class="divide-y divide-border">
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Detection rate</p>
						<p class="text-[11px] text-faint">Higher is snappier but uses more CPU.</p>
					</div>
					<select
						value={general.detectionFps}
						onchange={(e) => app.setGeneral({ detectionFps: +(e.target as HTMLSelectElement).value })}
						class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-border-strong"
					>
						{#each FPS_OPTIONS as f (f)}
							<option value={f}>{f} fps</option>
						{/each}
					</select>
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Sensitivity</p>
						<p class="text-[11px] text-faint">Scales every trigger's match score. Current {general.sensitivity.toFixed(2)}×.</p>
					</div>
					<input
						type="range"
						min="0.5"
						max="1.5"
						step="0.05"
						value={general.sensitivity}
						oninput={(e) => app.setGeneral({ sensitivity: +(e.target as HTMLInputElement).value })}
						class="fb-range w-44"
					/>
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Mirror preview</p>
						<p class="text-[11px] text-faint">Flip the camera preview like a mirror.</p>
					</div>
					<Toggle checked={general.mirror} onChange={(v) => app.setGeneral({ mirror: v })} label="Mirror" />
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Low-light boost</p>
						<p class="text-[11px] text-faint">Auto-brighten dark frames so detection works in dim rooms.</p>
					</div>
					<Toggle
						checked={general.enhanceLowLight}
						onChange={(v) => {
							app.setGeneral({ enhanceLowLight: v });
							engine.enhance = v;
						}}
						label="Low-light boost"
					/>
				</div>
			</div>
		</div>

		<!-- Shortcut -->
		<div class="rounded-card border border-border bg-surface-1">
			<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
				Shortcut
			</h2>
			<div class="flex items-center justify-between gap-4 px-5 py-3.5">
				<div>
					<p class="text-[13px]">Toggle detection</p>
					<p class="text-[11px] text-faint">Global hotkey to start/stop the soundboard from anywhere.</p>
				</div>
				<ShortcutCapture value={app.settings.shortcuts.toggleDetection} onChange={setShortcut} />
			</div>
		</div>

		<!-- Behavior -->
		<div class="rounded-card border border-border bg-surface-1">
			<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
				Behavior
			</h2>
			<div class="divide-y divide-border">
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Close to tray</p>
						<p class="text-[11px] text-faint">Keep running and detecting when you close the window.</p>
					</div>
					<Toggle checked={general.closeToTray} onChange={(v) => setBehavior({ closeToTray: v })} label="Close to tray" />
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Start minimized</p>
						<p class="text-[11px] text-faint">Launch straight to the tray.</p>
					</div>
					<Toggle checked={general.startMinimized} onChange={(v) => setBehavior({ startMinimized: v })} label="Start minimized" />
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Auto-start detection</p>
						<p class="text-[11px] text-faint">Begin detecting as soon as the app launches.</p>
					</div>
					<Toggle checked={general.autostartDetection} onChange={(v) => app.setGeneral({ autostartDetection: v })} label="Auto-start detection" />
				</div>
			</div>
		</div>

		<!-- Camera -->
		<div class="rounded-card border border-border bg-surface-1">
			<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
				Camera
			</h2>
			<div class="flex items-center justify-between gap-4 px-5 py-3.5">
				<div>
					<p class="text-[13px]">Default camera</p>
					<p class="text-[11px] text-faint">
						{engine.devices.length ? 'Used when detection starts.' : 'Start detection once to list cameras.'}
					</p>
				</div>
				<select
					value={general.cameraDeviceId ?? ''}
					onchange={(e) => app.setGeneral({ cameraDeviceId: (e.target as HTMLSelectElement).value || null })}
					disabled={engine.devices.length === 0}
					class="max-w-52 truncate rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-border-strong disabled:opacity-50"
				>
					<option value="">Default camera</option>
					{#each engine.devices as d (d.deviceId)}
						<option value={d.deviceId}>{d.label}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Phone camera -->
		{#if bridge}
			<div class="rounded-card border border-border bg-surface-1">
				<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
					Phone camera
				</h2>
				<PhoneSetup />
			</div>
		{/if}
	</div>
</section>
