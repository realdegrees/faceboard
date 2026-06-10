import { engine } from '../detection/engine.svelte';
import type { ModalityFlags } from '../detection/mediapipe';
import type { DetectionFrame, HandData } from '../detection/types';
import { app } from '../stores/app.svelte';
import type { Trigger } from '../types';
import { scoreTrigger } from './matcher';
import {
	DYN_LEN,
	dtw,
	handsFrameVector,
	mirrorX,
	normalizeSequence,
	orderHands,
	resampleSequence,
	swapHands
} from './features';

interface TriggerRunState {
	holdStart: number | null;
	lastFired: number;
	/** Whether the next sustained detection is allowed to fire. */
	armed: boolean;
	/** When the pose dropped below the release threshold (null while detected). */
	releasedSince: number | null;
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

function centroid(h: HandData): [number, number, number] {
	let x = 0, y = 0, z = 0;
	for (const p of h.landmarks) {
		x += p.x;
		y += p.y;
		z += p.z;
	}
	const n = h.landmarks.length || 1;
	return [x / n, y / n, z / n];
}
const dist3 = (a: [number, number, number], b: [number, number, number]) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How much the takes of a gesture vary among themselves — used to auto-calibrate
 *  the match threshold so it doesn't need manual tuning. */
function baseline(takes: number[][][]): number {
	if (takes.length < 2) return 0.45;
	let sum = 0;
	let c = 0;
	for (let i = 0; i < takes.length; i++) {
		for (let j = i + 1; j < takes.length; j++) {
			sum += dtw(takes[i], takes[j]);
			c++;
		}
	}
	return c ? Math.max(0.1, sum / c) : 0.45;
}

// Motion segmentation thresholds (normalized image-space speed per frame).
const MOTION_ON = 0.012;
const MOTION_OFF = 0.006;
const STILL_MS = 280;
const MAX_SEG_MS = 3500;

/**
 * Static triggers are scored per frame (edge-triggered with an armed flag, so a
 * sound fires once per detection and re-arms after release). Dynamic gestures use
 * motion segmentation: a segment starts when the hand begins moving and ends when
 * it stops; the isolated segment is matched against the recorded takes with DTW,
 * scored relative to how much the takes vary (auto-calibrated).
 */
class TriggerRuntime {
	scores = $state<Record<string, number>>({});
	activeIds = $state<string[]>([]);
	recent = $state<{ id: string; name: string; ts: number }[]>([]);

	onFire: ((trigger: Trigger) => void) | null = null;

	#runState = new Map<string, TriggerRunState>();
	#wired = false;

	#handBuffer: { tsMs: number; hands: HandData[] }[] = [];
	#bufferMs = 4500;
	#dynamicScores: Record<string, number> = {};

	// Motion segmenter
	#segActive = false;
	#segStart = 0;
	#stillSince: number | null = null;
	#prevCentroid: [number, number, number] | null = null;

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
		const ts = frame.tsMs;

		// Static triggers (per-frame), edge-triggered with an armed flag.
		for (const t of triggers) {
			if (!t.enabled || isDynamic(t)) continue;
			const score = scoreTrigger(t, frame) * sensitivity;
			nextScores[t.id] = score;
			const st = this.#stateFor(t.id);
			if (score >= t.threshold) {
				active.push(t.id);
				st.releasedSince = null;
				if (st.holdStart === null) st.holdStart = ts;
				if (st.armed && ts - st.holdStart >= t.holdMs) {
					st.lastFired = ts;
					st.armed = false;
					this.#fire(t);
				}
			} else {
				if (score < t.threshold * 0.8) {
					st.holdStart = null;
					if (st.releasedSince === null) st.releasedSince = ts;
				}
				if (!st.armed && st.releasedSince !== null && ts - st.releasedSince >= t.cooldownMs) {
					st.armed = true;
				}
			}
			if ((t.retrigger ?? 'once') === 'while-held' && !st.armed && ts - st.lastFired >= t.cooldownMs) {
				st.armed = true;
			}
		}

		// Buffer hands + run the motion segmenter for dynamic gestures.
		this.#handBuffer.push({ tsMs: ts, hands: frame.hands });
		while (this.#handBuffer.length && ts - this.#handBuffer[0].tsMs > this.#bufferMs) {
			this.#handBuffer.shift();
		}
		this.#segment(frame, triggers, sensitivity);
		for (const t of triggers) {
			if (!t.enabled || !isDynamic(t)) continue;
			const s = this.#segActive ? (this.#dynamicScores[t.id] ?? 0) : 0;
			nextScores[t.id] = s;
			if (s >= t.threshold) active.push(t.id);
		}

		this.scores = nextScores;
		this.activeIds = active;
	}

	#segment(frame: DetectionFrame, triggers: Trigger[], sensitivity: number): void {
		const ts = frame.tsMs;
		const hand = orderHands(frame.hands, 1)?.[0] ?? null;
		const c = hand ? centroid(hand) : null;
		let speed = 0;
		if (c && this.#prevCentroid) speed = dist3(c, this.#prevCentroid);
		this.#prevCentroid = c;

		if (!this.#segActive) {
			if (c && speed > MOTION_ON) {
				this.#segActive = true;
				this.#segStart = ts;
				this.#stillSince = null;
			}
			return;
		}

		// Ongoing segment: track stillness / hand loss.
		if (!c || speed < MOTION_OFF) {
			if (this.#stillSince === null) this.#stillSince = ts;
		} else {
			this.#stillSince = null;
		}
		const ended =
			(this.#stillSince !== null && ts - this.#stillSince >= STILL_MS) || ts - this.#segStart >= MAX_SEG_MS;

		this.#scoreDynamic(triggers, sensitivity, this.#segStart, ts, ended);
		if (ended) {
			this.#segActive = false;
			this.#stillSince = null;
		}
	}

	#scoreDynamic(triggers: Trigger[], sensitivity: number, start: number, end: number, fire: boolean): void {
		for (const t of triggers) {
			if (!t.enabled || !isDynamic(t) || !t.sequences?.length) continue;
			const count = t.hands === 2 ? 2 : 1;
			const raw = this.#buildSequence(count, start, end);
			let score = 0;
			if (raw.length >= 8) {
				const live = resampleSequence(normalizeSequence(raw), DYN_LEN);
				const candidates: number[][][] = [live];
				if (t.eitherHand) {
					candidates.push(live.map(mirrorX));
					if (count === 2) {
						candidates.push(live.map(swapHands));
						candidates.push(live.map((f) => mirrorX(swapHands(f))));
					}
				}
				let d = Infinity;
				for (const cand of candidates) {
					for (const tmpl of t.sequences) {
						const dd = dtw(cand, tmpl);
						if (dd < d) d = dd;
					}
				}
				const b = baseline(t.sequences);
				score = clamp01(2 - d / Math.max(b, 0.08)) * sensitivity;
			}
			this.#dynamicScores[t.id] = score;

			if (fire && score >= t.threshold) {
				const st = this.#stateFor(t.id);
				if (end - st.lastFired >= Math.max(t.cooldownMs, 500)) {
					st.lastFired = end;
					this.#fire(t);
				}
			}
		}
	}

	#buildSequence(count: 1 | 2, start: number, end: number): number[][] {
		const frames: number[][] = [];
		for (const entry of this.#handBuffer) {
			if (entry.tsMs < start || entry.tsMs > end) continue;
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
			st = { holdStart: null, lastFired: -Infinity, armed: true, releasedSince: null };
			this.#runState.set(id, st);
		}
		return st;
	}
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const runtime = new TriggerRuntime();
