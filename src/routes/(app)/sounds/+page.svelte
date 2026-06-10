<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { getBridge } from '$lib/bridge';
	import { app } from '$lib/stores/app.svelte';
	import { soundPlayer } from '$lib/audio/player.svelte';
	import { newId } from '$lib/types';

	const sounds = $derived(app.settings.sounds);
	const bridge = getBridge();

	async function addSounds() {
		if (!bridge) return;
		const files = await bridge.sounds.openDialog();
		for (const f of files) {
			const sound = { id: newId(), label: f.name, path: f.path, createdAt: Date.now() };
			app.addSound(sound);
			void soundPlayer.load(sound.id, sound.path);
		}
	}

	function linkedCount(id: string): number {
		return app.settings.triggers.filter((t) => t.soundId === id).length;
	}

	function remove(id: string) {
		soundPlayer.invalidate(id);
		app.removeSound(id);
	}
</script>

<section class="mx-auto max-w-5xl px-8 py-7">
	<header class="mb-6 flex items-end justify-between gap-3">
		<div>
			<h1 class="text-[19px] font-semibold tracking-tight">Sounds</h1>
			<p class="mt-1 text-[13px] text-muted">Your sound library. Browse files and link them to triggers.</p>
		</div>
		<button
			onclick={addSounds}
			class="rounded-lg bg-accent/90 px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent"
		>
			Add sounds
		</button>
	</header>

	{#if sounds.length === 0}
		<div
			class="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center text-[13px] text-faint"
		>
			No sounds yet. Add audio files and link them to your triggers.
		</div>
	{:else}
		<div class="flex flex-col gap-2.5">
			{#each sounds as sound (sound.id)}
				{@const playing = soundPlayer.playingIds.includes(sound.id)}
				<div
					animate:flip={{ duration: 200 }}
					transition:fly={{ y: 8, duration: 160 }}
					class="flex items-center gap-3 rounded-card border bg-surface-1 p-3 transition-colors {playing
						? 'border-accent/50'
						: 'border-border'}"
				>
					<button
						onclick={() => soundPlayer.play(sound.id)}
						aria-label="Preview"
						class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted transition-colors hover:text-accent"
					>
						{#if playing}
							<span class="inline-block h-2 w-2 rounded-full bg-accent" style="animation: fb-pulse 1s ease-in-out infinite;"></span>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
						{/if}
					</button>

					<div class="min-w-0 flex-1">
						<input
							value={sound.label}
							onchange={(e) => app.updateSound(sound.id, { label: (e.target as HTMLInputElement).value })}
							class="w-full bg-transparent text-[13px] font-medium outline-none"
						/>
						<div class="flex items-center gap-2 text-[11px] text-faint">
							<span class="truncate">{sound.path}</span>
							{#if soundPlayer.missing[sound.id]}
								<span class="shrink-0 rounded border border-red-500/40 px-1 text-red-400">missing</span>
							{/if}
						</div>
					</div>

					{#if linkedCount(sound.id) > 0}
						<span class="shrink-0 text-[11px] text-faint">
							{linkedCount(sound.id)} linked
						</span>
					{/if}

					<button
						onclick={() => remove(sound.id)}
						aria-label="Delete"
						class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-red-400"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</section>
