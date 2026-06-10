import { BLENDSHAPE_NAMES } from '../detection/types';

/**
 * Face regions group blendshapes anatomically. A custom face expression is one
 * captured target plus a set of selected regions; it matches when the current
 * face is close to the target on *every* selected region (others are ignored).
 */
export interface FaceRegion {
	id: string;
	label: string;
	blendshapes: string[];
}

export const FACE_REGIONS: FaceRegion[] = [
	{ id: 'brow-left', label: 'Left brow', blendshapes: ['browDownLeft', 'browOuterUpLeft', 'browInnerUp'] },
	{ id: 'brow-right', label: 'Right brow', blendshapes: ['browDownRight', 'browOuterUpRight', 'browInnerUp'] },
	{ id: 'eye-left', label: 'Left eye', blendshapes: ['eyeBlinkLeft', 'eyeSquintLeft', 'eyeWideLeft'] },
	{ id: 'eye-right', label: 'Right eye', blendshapes: ['eyeBlinkRight', 'eyeSquintRight', 'eyeWideRight'] },
	{ id: 'cheeks', label: 'Cheeks', blendshapes: ['cheekPuff', 'cheekSquintLeft', 'cheekSquintRight'] },
	{ id: 'nose', label: 'Nose', blendshapes: ['noseSneerLeft', 'noseSneerRight'] },
	{
		id: 'mouth',
		label: 'Mouth',
		blendshapes: [
			'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
			'mouthFrownLeft', 'mouthFrownRight', 'mouthLeft', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
			'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight', 'mouthDimpleLeft',
			'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthLowerDownLeft',
			'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight'
		]
	},
	{ id: 'jaw', label: 'Jaw', blendshapes: ['jawForward', 'jawLeft', 'jawRight'] }
];

export const BLENDSHAPE_INDEX: Record<string, number> = Object.fromEntries(
	BLENDSHAPE_NAMES.map((n, i) => [n, i])
);

export function getRegion(id: string): FaceRegion | undefined {
	return FACE_REGIONS.find((r) => r.id === id);
}

const ACTIVATION_FLOOR = 0.12;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Match score in [0,1] of the current face against the captured target over a
 * region's blendshapes — based on the *pattern* of muscle activation (cosine
 * similarity), not absolute values. This makes a match depend only on the
 * expression, independent of head orientation and intensity. A minimum
 * activation is still required so a relaxed face never matches an active target.
 */
export function regionMatch(cur: number[], target: number[], region: FaceRegion): number {
	let dot = 0;
	let tn = 0;
	let cn = 0;
	for (const name of region.blendshapes) {
		const i = BLENDSHAPE_INDEX[name];
		if (i === undefined) continue;
		const t = target[i] ?? 0;
		const c = cur[i] ?? 0;
		dot += t * c;
		tn += t * t;
		cn += c * c;
	}
	const tNorm = Math.sqrt(tn);
	const cNorm = Math.sqrt(cn);
	// Target region is essentially neutral → require the current frame to be relaxed there too.
	if (tNorm < ACTIVATION_FLOOR) return cNorm < 0.18 ? 1 : clamp01(1 - (cNorm - 0.18) / 0.6);
	// Target is active but the current frame isn't expressing → no match.
	if (cNorm < ACTIVATION_FLOOR) return 0;
	return clamp01(dot / (tNorm * cNorm));
}

/** Peak activation of a captured target within a region (for auto-suggesting). */
export function regionActivation(target: number[], region: FaceRegion): number {
	let max = 0;
	for (const name of region.blendshapes) {
		const i = BLENDSHAPE_INDEX[name];
		if (i !== undefined) max = Math.max(max, target[i] ?? 0);
	}
	return max;
}

/** Regions a captured expression visibly activates — sensible defaults to weight. */
export function suggestRegions(target: number[], threshold = 0.22): string[] {
	return FACE_REGIONS.filter((r) => regionActivation(target, r) >= threshold).map((r) => r.id);
}
