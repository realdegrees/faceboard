<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getBridge } from '$lib/bridge';
	import { app } from '$lib/stores/app.svelte';
	import { engine } from '$lib/detection/engine.svelte';
	import { runtime } from '$lib/triggers/runtime.svelte';
	import { soundPlayer } from '$lib/audio/player.svelte';
	import { startDetection, toggleDetection } from '$lib/detection/control';
	import { APP_VERSION, APP_REPO } from '$lib/version';

	let { children } = $props();

	const bridge = getBridge();

	// Load persisted settings; wire the matcher to detection frames, fired triggers
	// to sound playback, and the global hotkey / tray to detection toggling.
	onMount(() => {
		runtime.init();
		runtime.onFire = (trigger) => {
			if (trigger.soundId) void soundPlayer.play(trigger.soundId, trigger.volume ?? 1);
		};
		// 'while-active' (gate) triggers: loop the sound while active, stop on release.
		runtime.onGateStart = (trigger) => {
			if (trigger.soundId) void soundPlayer.startGate(trigger.soundId, trigger.volume ?? 1);
		};
		runtime.onGateStop = (trigger) => {
			if (trigger.soundId) soundPlayer.stopGate(trigger.soundId);
		};
		const offToggle = bridge?.detection.onToggle(() => void toggleDetection());

		void (async () => {
			await app.load();
			void soundPlayer.setOutputDevice(app.settings.general.audioOutputDeviceId);
			soundPlayer.preloadAll();
			const accel = app.settings.shortcuts.toggleDetection;
			if (accel) await bridge?.shortcuts.register(accel);
			if (app.settings.general.autostartDetection) await startDetection();
		})();

		return () => offToggle?.();
	});

	type NavItem = { href: string; label: string; icon: 'dashboard' | 'trigger' | 'sound' | 'settings' };
	const nav: NavItem[] = [
		{ href: '/', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/expressions', label: 'Triggers', icon: 'trigger' },
		{ href: '/sounds', label: 'Sounds', icon: 'sound' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	const current = $derived(page.url.pathname);
	function isActive(href: string): boolean {
		return href === '/' ? current === '/' : current.startsWith(href);
	}
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
	<!-- Custom frameless title bar (draggable). -->
	<header
		class="flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface-1/60 pl-3 select-none"
		style="-webkit-app-region: drag;"
	>
		<div class="flex items-center gap-2 text-[12px] font-medium tracking-wide text-muted">
			<span class="inline-block h-2 w-2 rounded-full bg-accent/80"></span>
			<span class="text-text">faceboard</span>
		</div>
		<div class="flex items-center" style="-webkit-app-region: no-drag;">
			<button
				class="grid h-9 w-11 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
				aria-label="Minimize"
				onclick={() => bridge?.window.minimize()}
			>
				<svg width="11" height="11" viewBox="0 0 11 11"><rect y="5" width="11" height="1" fill="currentColor" /></svg>
			</button>
			<button
				class="grid h-9 w-11 place-items-center text-muted transition-colors hover:bg-red-500/80 hover:text-white"
				aria-label="Close"
				onclick={() => bridge?.window.close()}
			>
				<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.1">
					<path d="M1 1l9 9M10 1l-9 9" />
				</svg>
			</button>
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		<!-- Sidebar -->
		<nav class="flex w-[210px] shrink-0 flex-col border-r border-border bg-surface-1/40 p-3">
			<div class="flex flex-col gap-1">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors
							{isActive(item.href)
							? 'bg-surface-2 text-text'
							: 'text-muted hover:bg-surface-1 hover:text-text'}"
					>
						<span
							class="grid place-items-center transition-colors {isActive(item.href)
								? 'text-accent'
								: 'text-faint group-hover:text-muted'}"
						>
							{#if item.icon === 'dashboard'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
							{:else if item.icon === 'trigger'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>
							{:else if item.icon === 'sound'}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/></svg>
							{:else}
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
							{/if}
						</span>
						{item.label}
					</a>
				{/each}
			</div>

			<div class="mt-auto rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-[11px]">
				<div class="flex items-center gap-2">
					<span
						class="inline-block h-1.5 w-1.5 rounded-full {engine.active
							? 'bg-accent'
							: engine.status === 'error'
								? 'bg-red-500'
								: 'bg-faint'}"
						style={engine.active ? 'animation: fb-pulse 2s ease-in-out infinite;' : ''}
					></span>
					<span class={engine.active ? 'text-muted' : 'text-faint'}>
						{engine.detecting
							? `Detection live · ${engine.fps} fps`
							: engine.status === 'loading'
								? 'Starting…'
								: engine.status === 'error'
									? 'Camera error'
									: engine.cameraOn
										? 'Camera on'
										: 'Detection idle'}
					</span>
				</div>
			</div>

			<div class="mt-2 flex items-center justify-between px-1 text-[11px] text-faint">
				<span>Faceboard v{APP_VERSION}</span>
				<a href={APP_REPO} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 transition-colors hover:text-text">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.85 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>
					GitHub
				</a>
			</div>
		</nav>

		<!-- Page content -->
		<main class="min-w-0 flex-1 overflow-y-auto">
			{@render children()}
		</main>
	</div>
</div>
