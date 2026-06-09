import { engine } from '../detection/engine.svelte';
import type { ModalityFlags } from '../detection/mediapipe';
import type { DetectionFrame } from '../detection/types';
import { app } from '../stores/app.svelte';
import type { Trigger } from '../types';
import { scoreTrigger } from './matcher';

interface TriggerRunState {
	holdStart: number | null;
	lastFired: number;
}

/** Modalities required by the currently enabled triggers (both if none yet). */
export function neededModalities(triggers: Trigger[]): ModalityFlags {
	const enabled = triggers.filter((t) => t.enabled);
	if (enabled.length === 0) return { face: true, hand: true };
	return {
		face: enabled.some((t) => t.modality === 'face'),
		hand: enabled.some((t) => t.modality === 'hand')
	};
}

/**
 * Runs the matcher against every detection frame and turns sustained matches
 * into fire events, respecting per-trigger hold + cooldown with a release
 * margin for hysteresis. Live scores/active ids are exposed for the UI.
 */
class TriggerRuntime {
	/** trigger id -> latest activation score in [0,1]. */
	scores = $state<Record<string, number>>({});
	/** trigger ids currently above threshold. */
	activeIds = $state<string[]>([]);
	/** recent fire events, newest first. */
	recent = $state<{ id: string; name: string; ts: number }[]>([]);

	/** Set by the sound layer to actually play audio on a fire. */
	onFire: ((trigger: Trigger) => void) | null = null;

	#runState = new Map<string, TriggerRunState>();
	#wired = false;

	init(): void {
		if (this.#wired) return;
		engine.onFrame = (frame) => this.process(frame);
		this.#wired = true;
	}

	process(frame: DetectionFrame): void {
		const triggers = app.settings.triggers;
		const sensitivity = app.settings.general.sensitivity;
		const nextScores: Record<string, number> = {};
		const active: string[] = [];

		for (const t of triggers) {
			if (!t.enabled) continue;
			const score = scoreTrigger(t, frame) * sensitivity;
			nextScores[t.id] = score;
			const st = this.#stateFor(t.id);

			if (score >= t.threshold) {
				active.push(t.id);
				if (st.holdStart === null) st.holdStart = frame.tsMs;
				const held = frame.tsMs - st.holdStart;
				if (held >= t.holdMs && frame.tsMs - st.lastFired >= t.cooldownMs) {
					st.lastFired = frame.tsMs;
					this.#fire(t);
				}
			} else if (score < t.threshold * 0.8) {
				// release margin avoids flicker right at the threshold
				st.holdStart = null;
			}
		}

		this.scores = nextScores;
		this.activeIds = active;
	}

	#fire(trigger: Trigger): void {
		this.onFire?.(trigger);
		this.recent = [{ id: trigger.id, name: trigger.name, ts: Date.now() }, ...this.recent].slice(0, 12);
	}

	#stateFor(id: string): TriggerRunState {
		let st = this.#runState.get(id);
		if (!st) {
			st = { holdStart: null, lastFired: -Infinity };
			this.#runState.set(id, st);
		}
		return st;
	}
}

export const runtime = new TriggerRuntime();
