import type { Trigger } from '../types';
import type { DetectionFrame } from '../detection/types';
import { getPreset } from './presets';
import {
	bestCosine,
	bestPoseScore,
	expressionScore,
	faceVector,
	mirrorX,
	normalizeStaticPose,
	orderHands,
	pairwiseDescriptor,
	subtractNeutral
} from './features';

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
		// Neutral-relative expression match (auto-weighted by what moved), with an
		// optional head-pose gate.
		if (trigger.target) {
			return clampScore(
				expressionScore(frame.face, trigger.target, trigger.neutral, trigger.headPose, !!trigger.useHeadPose)
			);
		}
		// Legacy few-shot fallback (older triggers).
		if (trigger.samples?.length) {
			const c = subtractNeutral(faceVector(frame.face), trigger.neutral);
			const refs = trigger.neutral
				? trigger.samples.map((s) => subtractNeutral(s, trigger.neutral))
				: trigger.samples;
			return clampScore(bestCosine(c, refs));
		}
		return 0;
	}

	// hand static poses
	const samples = trigger.samples;
	if (!samples || samples.length === 0) return 0;
	const count = trigger.hands === 2 ? 2 : 1;
	// Rotation-invariant poses compare pairwise-distance descriptors so any
	// orientation matches (these are also mirror-invariant); otherwise compare
	// the oriented normalized landmarks.
	const rotInv = !!trigger.rotationInvariant;
	const either = !!trigger.eitherHand;
	const refs = rotInv ? samples.map(pairwiseDescriptor) : samples;
	const feat = (pose: number[]) => (rotInv ? pairwiseDescriptor(pose) : pose);

	// Candidate poses to compare: the detected hand(s), plus their mirror (other
	// hand) and/or swapped order when "either hand" is enabled.
	const candidates: number[][] = [];
	if (count === 1) {
		for (const h of frame.hands) {
			const v = normalizeStaticPose([h]);
			candidates.push(v);
			if (either && !rotInv) candidates.push(mirrorX(v));
		}
	} else {
		const ordered = orderHands(frame.hands, 2);
		if (!ordered) return 0;
		candidates.push(normalizeStaticPose(ordered));
		if (either) {
			candidates.push(normalizeStaticPose([ordered[1], ordered[0]]));
			if (!rotInv) {
				candidates.push(mirrorX(normalizeStaticPose(ordered)));
				candidates.push(mirrorX(normalizeStaticPose([ordered[1], ordered[0]])));
			}
		}
	}
	let best = 0;
	for (const c of candidates) best = Math.max(best, bestPoseScore(feat(c), refs));
	return clampScore(best);
}

function clampScore(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}
