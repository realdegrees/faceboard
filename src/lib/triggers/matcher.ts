import type { Trigger } from '../types';
import type { DetectionFrame } from '../detection/types';
import { getPreset } from './presets';
import { bestCosine, faceVector, normalizeStaticPose, orderHands, subtractNeutral } from './features';

/** Activation score in [0,1] for a trigger against one detection frame. */
export function scoreTrigger(trigger: Trigger, frame: DetectionFrame): number {
	return trigger.kind === 'builtin' ? scoreBuiltin(trigger, frame) : scoreCustom(trigger, frame);
}

function scoreBuiltin(trigger: Trigger, frame: DetectionFrame): number {
	const preset = getPreset(trigger.builtinId);
	if (!preset) return 0;
	if (preset.kind === 'face-rule') {
		return frame.face ? clampScore(preset.score(frame.face.blendshapes)) : 0;
	}
	// hand-gesture: best matching hand's confidence
	let best = 0;
	for (const h of frame.hands) {
		if (h.gesture && h.gesture.name === preset.gesture && h.gesture.score > best) {
			best = h.gesture.score;
		}
	}
	return best;
}

function scoreCustom(trigger: Trigger, frame: DetectionFrame): number {
	const samples = trigger.samples;
	if (!samples || samples.length === 0) return 0;

	if (trigger.modality === 'face') {
		if (!frame.face) return 0;
		const cur = subtractNeutral(faceVector(frame.face), trigger.neutral);
		const refs = trigger.neutral
			? samples.map((s) => subtractNeutral(s, trigger.neutral))
			: samples;
		return clampScore(bestCosine(cur, refs));
	}

	// hand static poses (dynamic gestures are matched temporally in the runtime)
	if (trigger.motion === 'dynamic') return 0;
	const count = trigger.hands === 2 ? 2 : 1;
	if (count === 1) {
		let best = 0;
		for (const h of frame.hands) {
			best = Math.max(best, bestCosine(normalizeStaticPose([h]), samples));
		}
		return clampScore(best);
	}
	const ordered = orderHands(frame.hands, 2);
	if (!ordered) return 0;
	return clampScore(bestCosine(normalizeStaticPose(ordered), samples));
}

function clampScore(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}
