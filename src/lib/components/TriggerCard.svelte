<script lang="ts">
	import { goto } from '$app/navigation';
	import { app } from '$lib/stores/app.svelte';
	import { runtime } from '$lib/triggers/runtime.svelte';
	import { getPreset } from '$lib/triggers/presets';
	import { PRESET_HAND_POSES } from '$lib/triggers/handPoses';
	import EditFaceDialog from './EditFaceDialog.svelte';
	import HandSkeleton from './HandSkeleton.svelte';
	import type { Trigger } from '$lib/types';

	let { trigger }: { trigger: Trigger } = $props();

	const score = $derived(runtime.scores[trigger.id] ?? 0);
	const active = $derived(runtime.activeIds.includes(trigger.id));
	const sounds = $derived(app.settings.sounds);
	// Custom face expressions use the region-weighted model and are editable.
	const editable = $derived(trigger.modality === 'face' && trigger.kind === 'custom' && !!trigger.regions);

	// Hand-pose skeleton frames: canonical pose for presets, captured for custom.
	const handFrames = $derived.by<number[][] | null>(() => {
		if (trigger.modality !== 'hand') return null;
		if (trigger.kind === 'builtin') {
			const preset = getPreset(trigger.builtinId);
			const pose = preset && preset.kind === 'hand-gesture' ? PRESET_HAND_POSES[preset.gesture] : null;
			return pose ? [pose] : null;
		}
		if (trigger.motion === 'dynamic') return trigger.sequences?.length ? trigger.sequences[0] : null;
		return trigger.samples?.length ? [trigger.samples[0]] : null;
	});

	let editing = $state(false);

	function setThreshold(e: Event) {
		app.updateTrigger(trigger.id, { threshold: +(e.target as HTMLInputElement).value });
	}
	function setHold(e: Event) {
		app.updateTrigger(trigger.id, { holdMs: Math.max(0, +(e.target as HTMLInputElement).value || 0) });
	}
	function setCooldown(e: Event) {
		app.updateTrigger(trigger.id, { cooldownMs: Math.max(0, +(e.target as HTMLInputElement).value || 0) });
	}
	function setSound(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		if (v === '__add') {
			void goto('/sounds');
			return;
		}
		app.updateTrigger(trigger.id, { soundId: v || null });
	}
</script>

<div
	class="rounded-card border bg-surface-1 p-4 transition-colors {active
		? 'border-accent/50'
		: 'border-border'}"
>
	<div class="flex items-center gap-3">
		{#if trigger.modality === 'hand' && handFrames}
			<div class="shrink-0">
				<HandSkeleton frames={handFrames} size={64} />
			</div>
		{:else}
			<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>
			</span>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="truncate text-[14px] font-medium">{trigger.name}</span>
				<span
					class="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] tracking-wide text-faint uppercase"
				>
					{trigger.kind === 'builtin' ? 'Preset' : 'Custom'}
				</span>
				{#if trigger.modality === 'hand' && trigger.kind === 'custom'}
					<span class="shrink-0 text-[10px] text-faint">
						{trigger.hands === 2 ? '2-hand' : '1-hand'} · {trigger.motion === 'dynamic' ? 'gesture' : 'pose'}
					</span>
				{/if}
			</div>
		</div>

		<!-- enable switch -->
		<button
			role="switch"
			aria-checked={trigger.enabled}
			aria-label="Enabled"
			onclick={() => app.updateTrigger(trigger.id, { enabled: !trigger.enabled })}
			class="relative h-5 w-9 shrink-0 rounded-full transition-colors {trigger.enabled
				? 'bg-accent/80'
				: 'bg-surface-3'}"
		>
			<span
				class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform {trigger.enabled
					? 'translate-x-4'
					: ''}"
			></span>
		</button>

		{#if editable}
			<button
				onclick={() => (editing = true)}
				aria-label="Edit"
				class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-text"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
			</button>
		{/if}

		<button
			onclick={() => app.removeTrigger(trigger.id)}
			aria-label="Delete"
			class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-red-400"
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>
		</button>
	</div>

	<!-- live score bar with threshold marker -->
	<div class="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
		<div
			class="h-full rounded-full transition-[width] duration-75 {active ? 'bg-accent' : 'bg-muted/50'}"
			style="width: {Math.round(score * 100)}%"
		></div>
		<div class="absolute inset-y-0 w-0.5 bg-text/70" style="left: {Math.round(trigger.threshold * 100)}%"></div>
	</div>

	<!-- controls -->
	<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<label class="col-span-2 flex flex-col gap-1 sm:col-span-1">
			<span class="text-[11px] text-faint">Sound</span>
			<select
				value={trigger.soundId ?? ''}
				onchange={setSound}
				class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-muted outline-none focus:border-border-strong"
			>
				<option value="">{sounds.length ? 'None' : 'No sounds yet'}</option>
				{#each sounds as s (s.id)}
					<option value={s.id}>{s.label}</option>
				{/each}
				<option value="__add">＋ Add a sound…</option>
			</select>
		</label>

		<label class="col-span-2 flex flex-col gap-1 sm:col-span-1">
			<span class="text-[11px] text-faint">Threshold · {trigger.threshold.toFixed(2)}</span>
			<input
				type="range"
				min="0.2"
				max="0.98"
				step="0.01"
				value={trigger.threshold}
				oninput={setThreshold}
				class="fb-range mt-1.5"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span class="text-[11px] text-faint">Hold (ms)</span>
			<input
				type="number"
				min="0"
				step="50"
				value={trigger.holdMs}
				oninput={setHold}
				class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] outline-none focus:border-border-strong"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span class="text-[11px] text-faint">Cooldown (ms)</span>
			<input
				type="number"
				min="0"
				step="50"
				value={trigger.cooldownMs}
				oninput={setCooldown}
				class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] outline-none focus:border-border-strong"
			/>
		</label>
	</div>
</div>

{#if editing}
	<EditFaceDialog {trigger} onClose={() => (editing = false)} />
{/if}
