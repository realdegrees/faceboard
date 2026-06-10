<script lang="ts">
	import { getBridge } from '$lib/bridge';
	import { app } from '$lib/stores/app.svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import ShortcutCapture from '$lib/components/ShortcutCapture.svelte';
	import PhoneSetup from '$lib/components/PhoneSetup.svelte';
	import { APP_VERSION, APP_REPO } from '$lib/version';

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

		<!-- About -->
		<div class="rounded-card border border-border bg-surface-1">
			<h2 class="border-b border-border px-5 py-3 text-[12px] font-medium tracking-wide text-muted uppercase">
				About
			</h2>
			<div class="divide-y divide-border">
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Faceboard</p>
						<p class="text-[11px] text-faint">Version {APP_VERSION}</p>
					</div>
					<span class="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[12px] text-muted">v{APP_VERSION}</span>
				</div>
				<div class="flex items-center justify-between gap-4 px-5 py-3.5">
					<div>
						<p class="text-[13px]">Source &amp; releases</p>
						<p class="text-[11px] text-faint">View the code, report issues, or download other versions.</p>
					</div>
					<div class="flex items-center gap-2">
						<a
							href={APP_REPO}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text transition-colors hover:border-border-strong"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.85 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>
							GitHub
						</a>
						<a
							href="{APP_REPO}/releases"
							target="_blank"
							rel="noreferrer"
							class="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text transition-colors hover:border-border-strong"
						>
							Releases
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
