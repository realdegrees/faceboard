import { engine } from '../detection/engine.svelte';
import type { ModalityFlags } from '../detection/mediapipe';
import type { DetectionFrame, HandData } from '../detection/types';
import { app } from '../stores/app.svelte';
import type { Trigger } from '../types';
import { scoreTrigger } from './matcher';
import {
	DYN_LEN,
	dtw,
	dynamicScore,
	handsFrameVector,
	normalizeSequence,
	orderHands,
	resampleSequence
} from './features';

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

function isDynamic(t: Trigger): boolean {
	return t.modality === 'hand' && t.kind === 'custom' && t.motion === 'dynamic';
}

/**
 * Runs the matcher against every detection frame. Static triggers (face rules,
 * builtin gestures, custom poses) are scored per-frame with hold + cooldown.
 * Dynamic gestures are matched temporally: recent hand frames are buffered and
 * compared to each gesture's templates with DTW (throttled), firing on a match.
 */
class TriggerRuntime {
	scores = $state<Record<string, number>>({});
	activeIds = $state<string[]>([]);
	recent = $state<{ id: string; name: string; ts: number }[]>([]);

	onFire: ((trigger: Trigger) => void) | null = null;

	#runState = new Map<string, TriggerRunState>();
	#wired = false;

	// Dynamic gesture buffer
	#handBuffer: { tsMs: number; hands: HandData[] }[] = [];
	#bufferMs = 4000;
	#dynamicScores: Record<string, number> = {};
	#lastDynamicEval = 0;

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

		// Static triggers (per-frame).
		for (const t of triggers) {
			if (!t.enabled || isDynamic(t)) continue;
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
				st.holdStart = null;
			}
		}

		// Buffer hands for dynamic matching.
		this.#handBuffer.push({ tsMs: frame.tsMs, hands: frame.hands });
		while (this.#handBuffer.length && frame.tsMs - this.#handBuffer[0].tsMs > this.#bufferMs) {
			this.#handBuffer.shift();
		}

		// Evaluate dynamic gestures (throttled — DTW is heavier).
		if (frame.tsMs - this.#lastDynamicEval >= 120) {
			this.#lastDynamicEval = frame.tsMs;
			this.#evalDynamic(frame, triggers, sensitivity);
		}
		for (const t of triggers) {
			if (!t.enabled || !isDynamic(t)) continue;
			const s = this.#dynamicScores[t.id] ?? 0;
			nextScores[t.id] = s;
			if (s >= t.threshold) active.push(t.id);
		}

		this.scores = nextScores;
		this.activeIds = active;
	}

	#evalDynamic(frame: DetectionFrame, triggers: Trigger[], sensitivity: number): void {
		for (const t of triggers) {
			if (!t.enabled || !isDynamic(t) || !t.sequences?.length) continue;
			const count = t.hands === 2 ? 2 : 1;
			const seq = this.#buildSequence(count, t.durationMs ?? 1500, frame.tsMs);
			let score = 0;
			if (seq.length >= 8) {
				const live = resampleSequence(normalizeSequence(seq), DYN_LEN);
				let best = Infinity;
				for (const tmpl of t.sequences) {
					const d = dtw(live, tmpl);
					if (d < best) best = d;
				}
				score = dynamicScore(best) * sensitivity;
			}
			this.#dynamicScores[t.id] = score;

			const st = this.#stateFor(t.id);
			const cooldown = Math.max(t.cooldownMs, 600);
			if (score >= t.threshold && frame.tsMs - st.lastFired >= cooldown) {
				st.lastFired = frame.tsMs;
				this.#fire(t);
			}
		}
	}

	/** Build a per-frame feature sequence from the buffered window of hand frames
	 *  that contain the required number of hands. */
	#buildSequence(count: 1 | 2, durationMs: number, nowTs: number): number[][] {
		const start = nowTs - Math.min(durationMs * 1.4, this.#bufferMs);
		const frames: number[][] = [];
		for (const entry of this.#handBuffer) {
			if (entry.tsMs < start) continue;
			const ordered = orderHands(entry.hands, count);
			if (ordered) frames.push(handsFrameVector(ordered));
		}
		return frames;
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
