import type { Trigger } from '../types';
import type { DetectionFrame } from '../detection/types';
import { getPreset } from './presets';
import { bestCosine, faceVector, normalizeStaticPose, orderHands, subtractNeutral } from './features';
import { getRegion, regionMatch } from './regions';

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
	if (trigger.modality === 'face') {
		if (!frame.face) return 0;
		const cur = faceVector(frame.face);
		// Region-weighted single-capture model: every selected region must match.
		if (trigger.target && trigger.regions?.length) {
			let min = 1;
			for (const id of trigger.regions) {
				const region = getRegion(id);
				if (!region) continue;
				const s = regionMatch(cur, trigger.target, region);
				if (s < min) min = s;
			}
			return clampScore(min);
		}
		// Legacy few-shot fallback.
		if (trigger.samples?.length) {
			const c = subtractNeutral(cur, trigger.neutral);
			const refs = trigger.neutral
				? trigger.samples.map((s) => subtractNeutral(s, trigger.neutral))
				: trigger.samples;
			return clampScore(bestCosine(c, refs));
		}
		return 0;
	}

	// hand static poses (dynamic gestures are matched temporally in the runtime)
	if (trigger.motion === 'dynamic') return 0;
	const samples = trigger.samples;
	if (!samples || samples.length === 0) return 0;
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
