import { engine } from '../detection/engine.svelte';
import type { DetectionFrame } from '../detection/types';
import { app } from '../stores/app.svelte';
import type { Trigger } from '../types';
import { scoreTrigger } from './matcher';

interface TriggerRunState {
	holdStart: number | null;
	lastFired: number;
	/** Whether the next sustained detection is allowed to fire. */
	armed: boolean;
	/** When the pose dropped below the release threshold (null while detected). */
	releasedSince: number | null;
	/** 'while-active' (gate) playback is currently sounding for this trigger. */
	gateOn: boolean;
}

/**
 * Triggers are scored per frame (edge-triggered with an armed flag, so a sound
 * fires once per detection and re-arms after release).
 */
class TriggerRuntime {
	scores = $state<Record<string, number>>({});
	activeIds = $state<string[]>([]);
	recent = $state<{ id: string; name: string; ts: number }[]>([]);

	onFire: ((trigger: Trigger) => void) | null = null;
	/** 'while-active' playback: start when the trigger activates, stop when it ends. */
	onGateStart: ((trigger: Trigger) => void) | null = null;
	onGateStop: ((trigger: Trigger) => void) | null = null;

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
		const ts = frame.tsMs;

		for (const t of triggers) {
			if (!t.enabled) continue;
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
					this.#onDetection(t);
				}
			} else {
				// Pose no longer active — end any gated ('while-active') playback.
				if (st.gateOn) this.#stopGate(t, st);
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

		this.scores = nextScores;
		this.activeIds = active;
	}

	/** A confirmed detection edge — activate (fire once, or start gated playback). */
	#onDetection(t: Trigger): void {
		this.#activate(t, this.#stateFor(t.id));
	}

	#activate(t: Trigger, st: TriggerRunState): void {
		if ((t.playback ?? 'once') === 'while-active') {
			if (!st.gateOn) {
				st.gateOn = true;
				this.onGateStart?.(t);
				this.#recordRecent(t);
			}
			return;
		}
		this.#fire(t);
	}

	#stopGate(t: Trigger, st: TriggerRunState): void {
		st.gateOn = false;
		this.onGateStop?.(t);
	}

	/** Stop every active gate (e.g. when detection is turned off). */
	stopAllGates(): void {
		for (const [id, st] of this.#runState) {
			if (!st.gateOn) continue;
			st.gateOn = false;
			const t = app.settings.triggers.find((x) => x.id === id);
			if (t) this.onGateStop?.(t);
		}
	}

	#fire(trigger: Trigger): void {
		this.onFire?.(trigger);
		this.#recordRecent(trigger);
	}

	#recordRecent(trigger: Trigger): void {
		this.recent = [{ id: trigger.id, name: trigger.name, ts: Date.now() }, ...this.recent].slice(0, 12);
	}

	#stateFor(id: string): TriggerRunState {
		let st = this.#runState.get(id);
		if (!st) {
			st = { holdStart: null, lastFired: -Infinity, armed: true, releasedSince: null, gateOn: false };
			this.#runState.set(id, st);
		}
		return st;
	}
}

export const runtime = new TriggerRuntime();
